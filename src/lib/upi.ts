/**
 * UPI payment-link builder — shared by the invoice PDF QR and the order
 * page's "UPI QR" sheet.
 *
 * Produces an NPCI-style `upi://pay` deep link, e.g.
 *   upi://pay?pa=9662104002%40kotak&cu=INR&pn=Draep&am=3999.00&tn=Order%2312333
 *
 * Params: pa = payee VPA, cu = currency, pn = payee name,
 *         am = amount in rupees (2 decimals), tn = transaction note.
 */

export const UPI_VPA = "9662104002@kotak";
export const UPI_PAYEE_NAME = "Draep";

/** Build the QR payload. `amountRupees` should be what the customer still
 *  owes (balance due); `orderNumber` is the raw order number (e.g. "12333"),
 *  rendered as the note "Order#12333". */
export function buildUpiPayUrl(
  amountRupees: number,
  orderNumber: string,
): string {
  const am = Math.max(0, amountRupees).toFixed(2);
  const tn = `Order#${orderNumber}`;
  return (
    `upi://pay?pa=${encodeURIComponent(UPI_VPA)}` +
    `&cu=INR` +
    `&pn=${encodeURIComponent(UPI_PAYEE_NAME)}` +
    `&am=${am}` +
    `&tn=${encodeURIComponent(tn)}`
  );
}
