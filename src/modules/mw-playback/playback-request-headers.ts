import type { Context } from "hono";
import { ApiError } from "../../shared/http/api-error.js";

export const SUPPORTED_DEVICE_TYPES = ["Mobile", "SmartTV", "Web"] as const;

export type DeviceType = (typeof SUPPORTED_DEVICE_TYPES)[number];

export type PlaybackRequestHeaders = {
  userId: string;
  userCountry: string;
  deviceType: DeviceType;
};

export function readPlaybackRequestHeaders(c: Context): PlaybackRequestHeaders {
  return {
    userId: readRequiredHeader(c, "X-User-Id"),
    userCountry: readRequiredHeader(c, "X-User-Country"),
    deviceType: readDeviceTypeHeader(c),
  };
}

function readRequiredHeader(c: Context, headerName: string): string {
  const value = c.req.header(headerName)?.trim();

  if (!value) {
    throw new ApiError(
      400,
      "MISSING_HEADER",
      `${headerName} header is required`,
    );
  }

  return value;
}

function readDeviceTypeHeader(c: Context): DeviceType {
  const value = readRequiredHeader(c, "X-Device-Type");

  if (!isSupportedDeviceType(value)) {
    throw new ApiError(
      400,
      "INVALID_DEVICE_TYPE",
      `X-Device-Type must be one of: ${SUPPORTED_DEVICE_TYPES.join(", ")}`,
    );
  }

  return value;
}

function isSupportedDeviceType(value: string): value is DeviceType {
  return SUPPORTED_DEVICE_TYPES.includes(value as DeviceType);
}
