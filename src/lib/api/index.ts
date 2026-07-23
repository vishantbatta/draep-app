/**
 * API barrel — re-exports all domain modules for clean imports.
 *
 * Usage:
 *   import { createOrder, updateSelection } from "@/lib/api";
 */

export * as authApi from "./auth";
export * as catalogApi from "./catalog";
export * as ordersApi from "./orders";
export * as pricingApi from "./pricing";
export * as serviceAreaApi from "./serviceArea";
export * as checkoutApi from "./checkout";

export { ApiError, getToken, setToken, clearToken } from "./client";
