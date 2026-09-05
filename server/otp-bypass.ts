const KYRGYZ_PHONE_PATTERN = /^996\d{9}$/;

export function resolveOtpBypassPhone(configuredPhone: string | undefined) {
  if (!configuredPhone?.trim()) return null;
  const phone = configuredPhone.replace(/\D/g, "");
  if (!KYRGYZ_PHONE_PATTERN.test(phone)) {
    throw new Error("OTP_BYPASS_PHONE must contain one phone number in +996 format");
  }
  return phone;
}
