export function sarbonOffersLabel(language, count) {
  if (language === "uz") return "ta taklif";
  if (language === "en") return count === 1 ? "offer" : "offers";

  const absolute = Math.abs(count);
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "предложений";
  if (last === 1) return "предложение";
  if (last >= 2 && last <= 4) return "предложения";
  return "предложений";
}
