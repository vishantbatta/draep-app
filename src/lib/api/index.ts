/**
 * API barrel — re-exports all domain modules for clean imports.
 *
 * Usage:
 *   import { createOrder, updateSelection } from "@/lib/api";
 */

export * as authApi from "./auth";
export * as addressesApi from "./addresses";
export * as catalogApi from "./catalog";
export * as libraryApi from "./library";
export * as ordersApi from "./orders";
export * as pricingApi from "./pricing";
export * as serviceAreaApi from "./serviceArea";
export * as checkoutApi from "./checkout";
export * as bookingApi from "./booking";
export * as tryOnApi from "./tryon";
export * as myodApi from "./myod";
export * as stylistApi from "./stylist";

export { ApiError, getToken, setToken, clearToken } from "./client";
