import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const supabaseUrl = "https://hibkoggylocbvfoqimni.supabase.co";
const supabaseAnonKey = "sb_publishable_NoyMKt6mdsy7-2qGXkUBtw_GXb3LwYQ";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);