import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const supabaseUrl = "https://jwjqhzrdrvqxwcahxmmb.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3anFoenJkcnZxeHdjYWh4bW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjIzMjMsImV4cCI6MjEwNTAzODMyM30.UQRhdac_oFqxf71_XaKS3xunPc_3zDUxJrxcSz7IXKo";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);