import { userAISettingsRepository } from "../repositories/userAISettingsRepository";
import { getUserAISettings } from "./user-ai-settings";
import { normalizeServiceUrl, readProfiles } from "./embedding-config";
import { maskAICustomHeaders, normalizeAICustomHeaders, type AICustomHeaders } from "./ai-custom-headers";

export type SpeechCredentialSource = "custom" | "profile" | "chat";
export interface SpeechSettings {
  apiUrl: string; apiKey: string; model: string; language: string | null;
  source?: SpeechCredentialSource; profileId?: string; customHeaders?: AICustomHeaders;
  profileName?: string | null; error?: string | null;
}
export interface SpeechSettingsInput {
  apiUrl?: string; apiKey?: string; model: string; language: string | null;
  source?: SpeechCredentialSource; profileId?: string; customHeaders?: unknown;
}
const keys = ["speech_api_url", "speech_api_key", "speech_model", "speech_language", "speech_source", "speech_profile_id", "speech_custom_headers"];

/** Stored standalone fields remain intact when a channel is selected. */
export function getUserSpeechSettings(userId: string): SpeechSettings {
  const values = Object.fromEntries(userAISettingsRepository.getMany(userId, keys).map((row) => [row.key, row.value]));
  return {
    apiUrl: values.speech_api_url || "", apiKey: values.speech_api_key || "",
    model: values.speech_model || "whisper-1", language: values.speech_language || null,
    source: values.speech_source === "profile" || values.speech_source === "chat" ? values.speech_source : "custom",
    profileId: values.speech_profile_id || "", customHeaders: normalizeAICustomHeaders(values.speech_custom_headers || "{}"),
  };
}

export function buildUserSpeechSettings(userId: string, input: SpeechSettingsInput): SpeechSettings {
  const previous = getUserSpeechSettings(userId);
  return {
    ...previous, ...input, apiUrl: input.apiUrl === undefined ? previous.apiUrl : input.apiUrl.trim().replace(/\/+$/, ""),
    apiKey: input.apiKey === undefined ? previous.apiKey : input.apiKey,
    profileId: input.profileId?.trim() ?? previous.profileId,
    customHeaders: normalizeAICustomHeaders(input.customHeaders, previous.customHeaders),
  };
}

/** Resolve per request so channel edits take effect without copying credentials. */
export function resolveUserSpeechSettings(userId: string, stored = getUserSpeechSettings(userId)): SpeechSettings {
  if (stored.source === "profile") {
    const profile = readProfiles(userId).find(item => item.id === stored.profileId);
    if (!profile) return { ...stored, apiUrl: "", apiKey: "", customHeaders: {}, error: "语音绑定的厂商渠道不存在或已删除，请重新选择" };
    return { ...stored, apiUrl: normalizeServiceUrl(profile.provider, profile.apiUrl), apiKey: profile.apiKey, customHeaders: profile.customHeaders, profileName: profile.name };
  }
  if (stored.source === "chat") {
    const active = getUserAISettings(userId);
    return { ...stored, apiUrl: normalizeServiceUrl(active.ai_provider, active.ai_api_url), apiKey: active.ai_api_key, customHeaders: normalizeAICustomHeaders(active.ai_custom_headers) };
  }
  return stored;
}

export function setUserSpeechSettings(userId: string, input: SpeechSettingsInput): void {
  const settings = buildUserSpeechSettings(userId, input);
  const resolved = resolveUserSpeechSettings(userId, settings);
  if (resolved.error) throw new Error(resolved.error);
  userAISettingsRepository.setMany(userId, [
    { key: keys[0], value: settings.apiUrl }, { key: keys[1], value: settings.apiKey },
    { key: keys[2], value: settings.model }, { key: keys[3], value: settings.language || "" },
    { key: keys[4], value: settings.source || "custom" }, { key: keys[5], value: settings.profileId || "" },
    { key: keys[6], value: JSON.stringify(settings.customHeaders || {}) },
  ]);
}

export function publicSpeechSettings(settings: SpeechSettings, resolved = settings) {
  return {
    apiUrl: settings.apiUrl, model: settings.model, language: settings.language, apiKeySet: !!settings.apiKey,
    source: settings.source || "custom", profileId: settings.profileId || "", customHeaders: maskAICustomHeaders(settings.customHeaders || {}),
    profileName: resolved.profileName || null, error: resolved.error || null,
    configured: !resolved.error && !!resolved.apiUrl && !!resolved.model,
  };
}
