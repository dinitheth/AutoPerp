import { supabase } from "@/integrations/supabase/client";

export interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

export async function callGemini(
  messages: GeminiMessage[],
  systemInstruction: string
): Promise<string> {
  try {
    // Convert from Gemini format to OpenAI-compatible format
    const openaiMessages = messages.map((m) => ({
      role: m.role === "model" ? "assistant" : "user",
      content: m.parts.map((p) => p.text).join(""),
    }));

    const { data, error } = await supabase.functions.invoke("agent-chat", {
      body: {
        messages: openaiMessages,
        systemPrompt: systemInstruction,
      },
    });

    if (error) {
      console.error("Agent chat error:", error);
      return "⚠️ Something went wrong connecting to the AI. Please try again.";
    }

    if (data?.error) {
      console.error("Agent chat response error:", data.error);
      if (data.error.includes("Rate limited")) {
        return "⚠️ Rate limited. Please wait a moment and try again.";
      }
      return `⚠️ ${data.error}`;
    }

    return data?.text || "I couldn't generate a response. Please try again.";
  } catch (err) {
    console.error("Agent fetch error:", err);
    return "⚠️ Network error. Please check your connection and try again.";
  }
}
