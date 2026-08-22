// Copiar a web/config.js y completar. Los dos valores son publicos por diseno:
// la anon key solo puede leer, y lo que se puede leer es el ranking, que ya es
// publico. Aun asi config.js no se commitea: el workflow de Pages lo escribe en
// cada deploy desde las variables del repo.
//
// Sin este archivo el sitio arranca en modo demo contra web/demo.json.
window.ISAAC_CONFIG = {
  SUPABASE_URL: "https://TU_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "TU_PUBLISHABLE_KEY", // sb_publishable_...
};
