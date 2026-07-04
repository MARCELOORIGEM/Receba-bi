const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_PASSWORD = "RECEBA99";
const POWER_EMAIL = "recebapoder2026@gmail.com";
const DEFAULT_PERMISSIONS = {
  kpis: true,
  cadastro: true,
  financeiro: false,
  atualizar_bi: false,
  usuarios: false,
};

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function createSupabaseApi() {
  const router = express.Router();
  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const enabled = Boolean(url && anonKey && serviceKey);

  const admin = enabled
    ? createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;

  function publicClient() {
    return createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  function unavailable(res) {
    return res.status(503).json({
      error: "Supabase nao configurado. Defina SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.",
    });
  }

  function defaultProfile(user) {
    const power = normalizeEmail(user.email) === POWER_EMAIL;
    return {
      id: user.id,
      name: user.user_metadata?.name || user.email?.split("@")[0] || "Usuario",
      email: normalizeEmail(user.email),
      role: power ? "admin" : "usuario",
      access_area: power ? "ambos" : "operacional",
      active: true,
      permissions: power
        ? { ...DEFAULT_PERMISSIONS, financeiro: true, atualizar_bi: true, usuarios: true }
        : DEFAULT_PERMISSIONS,
      must_change_password: Boolean(user.user_metadata?.must_change_password),
    };
  }

  async function loadProfile(user) {
    const { data, error } = await admin
      .from("receba_profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (data) {
      return {
        ...data,
        email: normalizeEmail(user.email),
        must_change_password: Boolean(user.user_metadata?.must_change_password),
      };
    }

    const profile = defaultProfile(user);
    const { must_change_password: _ignored, ...profileRow } = profile;
    const { error: insertError } = await admin.from("receba_profiles").upsert(profileRow);
    if (insertError) throw insertError;
    return profile;
  }

  async function authenticate(req, res, next) {
    if (!enabled) return unavailable(res);
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Sessao ausente." });

    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: "Sessao invalida ou expirada." });

    try {
      const profile = await loadProfile(data.user);
      if (!profile.active) return res.status(403).json({ error: "Usuario inativo." });
      req.authUser = data.user;
      req.profile = profile;
      next();
    } catch (profileError) {
      res.status(500).json({ error: profileError.message });
    }
  }

  function requireAdmin(req, res, next) {
    const allowed = req.profile.role === "admin" || req.profile.permissions?.usuarios;
    if (!allowed) return res.status(403).json({ error: "Acesso restrito a administradores." });
    next();
  }

  function authorize(...permissions) {
    return (req, res, next) => {
      if (!enabled) return next();
      authenticate(req, res, () => {
        const isAdmin = req.profile.role === "admin";
        const allowed = isAdmin || permissions.some((permission) => req.profile.permissions?.[permission]);
        if (!allowed) return res.status(403).json({ error: "Usuario sem permissao para este recurso." });
        next();
      });
    };
  }

  router.get("/config", (_req, res) => {
    res.json({ enabled });
  });

  router.post("/login", async (req, res) => {
    if (!enabled) return unavailable(res);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const client = publicClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      console.error("Supabase login error:", error?.message || "Sessao ou usuario ausente");
      return res.status(401).json({ error: "Email ou senha incorretos." });
    }

    try {
      const profile = await loadProfile(data.user);
      if (!profile.active) return res.status(403).json({ error: "Usuario inativo." });
      res.json({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
        profile,
      });
    } catch (profileError) {
      res.status(500).json({ error: profileError.message });
    }
  });

  router.post("/refresh", async (req, res) => {
    if (!enabled) return unavailable(res);
    const refreshToken = String(req.body.refreshToken || "");
    if (!refreshToken) return res.status(401).json({ error: "Refresh token ausente." });
    const client = publicClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) return res.status(401).json({ error: "Sessao expirada." });

    const profile = await loadProfile(data.user);
    if (!profile.active) return res.status(403).json({ error: "Usuario inativo." });
    res.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
      profile,
    });
  });

  router.get("/me", authenticate, (req, res) => {
    res.json({ profile: req.profile });
  });

  router.post("/change-password", authenticate, async (req, res) => {
    const password = String(req.body.password || "");
    if (password.length < 6 || password === DEFAULT_PASSWORD) {
      return res.status(400).json({ error: "Escolha uma senha diferente da padrao com pelo menos 6 caracteres." });
    }

    const metadata = { ...req.authUser.user_metadata, must_change_password: false };
    const { error } = await admin.auth.admin.updateUserById(req.authUser.id, {
      password,
      user_metadata: metadata,
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  router.get("/users", authenticate, requireAdmin, async (_req, res) => {
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authError) return res.status(400).json({ error: authError.message });

    const { data: profiles, error: profileError } = await admin.from("receba_profiles").select("*");
    if (profileError) return res.status(400).json({ error: profileError.message });
    const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));

    const users = authData.users.map((user) => ({
      ...defaultProfile(user),
      ...(byId.get(user.id) || {}),
      email: normalizeEmail(user.email),
      must_change_password: Boolean(user.user_metadata?.must_change_password),
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
    }));
    res.json({ users });
  });

  router.post("/users", authenticate, requireAdmin, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || DEFAULT_PASSWORD);
    const name = String(req.body.name || "").trim();
    const role = req.body.role === "admin" ? "admin" : "usuario";
    const accessArea = ["operacional", "financeiro", "ambos"].includes(req.body.accessArea)
      ? req.body.accessArea
      : "operacional";
    const permissions = { ...DEFAULT_PERMISSIONS, ...(req.body.permissions || {}) };

    if (!email || !name) return res.status(400).json({ error: "Nome e email sao obrigatorios." });
    if (password.length < 6) return res.status(400).json({ error: "A senha precisa ter pelo menos 6 caracteres." });

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, must_change_password: password === DEFAULT_PASSWORD },
      app_metadata: { role, access_area: accessArea },
    });
    if (error || !data.user) return res.status(400).json({ error: error?.message || "Erro ao criar usuario." });

    const profile = {
      id: data.user.id,
      name,
      email,
      role,
      access_area: accessArea,
      active: true,
      permissions,
    };
    const { error: profileError } = await admin.from("receba_profiles").upsert(profile);
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return res.status(400).json({ error: profileError.message });
    }

    res.status(201).json({ user: { ...profile, must_change_password: password === DEFAULT_PASSWORD } });
  });

  router.patch("/users/:id", authenticate, requireAdmin, async (req, res) => {
    const updates = {};
    if (typeof req.body.name === "string") updates.name = req.body.name.trim();
    if (req.body.role) updates.role = req.body.role === "admin" ? "admin" : "usuario";
    if (req.body.accessArea) updates.access_area = req.body.accessArea;
    if (typeof req.body.active === "boolean") updates.active = req.body.active;
    if (req.body.permissions) updates.permissions = { ...DEFAULT_PERMISSIONS, ...req.body.permissions };

    const { data, error } = await admin
      .from("receba_profiles")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    if (updates.role || updates.access_area) {
      await admin.auth.admin.updateUserById(req.params.id, {
        app_metadata: {
          role: updates.role || data.role,
          access_area: updates.access_area || data.access_area,
        },
      });
    }
    res.json({ user: data });
  });

  router.post("/users/:id/reset-password", authenticate, requireAdmin, async (req, res) => {
    const { data: existing, error: fetchError } = await admin.auth.admin.getUserById(req.params.id);
    if (fetchError || !existing?.user) return res.status(404).json({ error: "Usuario nao encontrado." });

    const { error } = await admin.auth.admin.updateUserById(req.params.id, {
      password: DEFAULT_PASSWORD,
      user_metadata: { ...existing.user.user_metadata, must_change_password: true },
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true, password: DEFAULT_PASSWORD });
  });

  router.delete("/users/:id", authenticate, requireAdmin, async (req, res) => {
    if (req.params.id === req.authUser.id) return res.status(400).json({ error: "Voce nao pode excluir o proprio usuario." });
    const { error } = await admin.auth.admin.deleteUser(req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  return { router, authorize, enabled };
}

module.exports = { createSupabaseApi };
