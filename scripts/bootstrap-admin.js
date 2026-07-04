require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = "recebapoder2026@gmail.com";
const password = process.env.RECEBA_ADMIN_INITIAL_PASSWORD || "RECEBA99";

if (!url || !serviceKey) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;

  let user = usersData.users.find((item) => item.email?.toLowerCase() === email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: "Receba Poder", must_change_password: true },
      app_metadata: { role: "admin", access_area: "ambos" },
    });
    if (error) throw error;
    user = data.user;
  }

  const { error: profileError } = await supabase.from("receba_profiles").upsert({
    id: user.id,
    name: "Receba Poder",
    email,
    role: "admin",
    access_area: "ambos",
    active: true,
    permissions: {
      kpis: true,
      cadastro: true,
      financeiro: true,
      atualizar_bi: true,
      usuarios: true,
    },
  });
  if (profileError) throw profileError;

  console.log(`Administrador pronto: ${email}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
