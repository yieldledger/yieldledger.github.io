// Cloud accounts (optional). Paste your Supabase project URL and anon key to give every
// user a real account that syncs across devices. Leave blank and accounts live in the browser.
// The anon key is designed to be public; row-level security in supabase/schema.sql protects the data.
window.YL_CONFIG = {
  supabaseUrl: "https://wkaenrqztwlwasytwjed.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrYWVucnF6dHdsd2FzeXR3amVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2Mjc5MjIsImV4cCI6MjEwODIwMzkyMn0.zBO8XqgObc5ppBzvxag9EgXUCT1mL3RGcsdPdC4CYPM",
  // Sign-in buttons for providers turned on in Supabase → Authentication → Providers: "google", "azure" (Microsoft), "apple".
  oauth: [],
  // Optional tip jar: a Stripe Payment Link (Stripe → Payment Links → New → "Customers choose what to pay").
  // Leave blank to hide the "Support Yield Ledger" button.
  donateUrl: "",
  // Optional feedback inbox: a free Web3Forms access key (web3forms.com → enter your email → copy the key).
  // Feedback then arrives by email. Leave blank and the Feedback button opens a GitHub issue instead.
  feedbackKey: "8e07eee4-6804-4d38-b39f-12354074421d",
};
