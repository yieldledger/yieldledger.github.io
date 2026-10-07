// Cloud accounts (optional). Paste your Supabase project URL and anon key to give every
// user a real account that syncs across devices. Leave blank and accounts live in the browser.
// The anon key is designed to be public; row-level security in supabase/schema.sql protects the data.
window.YL_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  // Optional tip jar: a Stripe Payment Link (Stripe → Payment Links → New → "Customers choose what to pay").
  // Leave blank to hide the "Support Yield Ledger" button.
  donateUrl: "",
  // Optional feedback inbox: a free Web3Forms access key (web3forms.com → enter your email → copy the key).
  // Feedback then arrives by email. Leave blank and the Feedback button opens a GitHub issue instead.
  feedbackKey: "8e07eee4-6804-4d38-b39f-12354074421d",
};
