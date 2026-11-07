const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNokAmountMinor(minor: number): string {
  const amountMinor = BigInt(minor);
  const wholeUnits = amountMinor / 100n;
  const fraction = String((amountMinor < 0n ? -amountMinor : amountMinor) % 100n).padStart(2, "0");
  const signedWholeUnits = wholeUnits === 0n && amountMinor < 0n ? -0 : wholeUnits;

  return nokCurrencyFormatter.formatToParts(signedWholeUnits)
    .map((part) => part.type === "fraction" ? fraction : part.value)
    .join("");
}
