import axios from "axios";
import {
  HUBBLE_AUTH_LOGIN_URL,
  HUBBLE_CLIENT_ID,
  HUBBLE_CLIENT_SECRET,
  HUBBLE_TOKEN_TTL_MS,
} from "./constants.js";

let hubbleToken = null;

export async function getHubbleToken() {
  if (hubbleToken) return hubbleToken;

  if (!HUBBLE_CLIENT_ID || !HUBBLE_CLIENT_SECRET) {
    throw new Error("HUBBLE_CLIENT_ID and HUBBLE_CLIENT_SECRET env vars are required");
  }

  try {
    const res = await axios.post(
      HUBBLE_AUTH_LOGIN_URL,
      {
        clientId: HUBBLE_CLIENT_ID,
        clientSecret: HUBBLE_CLIENT_SECRET,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    hubbleToken = res.data.token;

    if (!hubbleToken) {
      throw new Error("No access token returned from Hubble login");
    }

    setTimeout(() => {
      hubbleToken = null;
    }, HUBBLE_TOKEN_TTL_MS);

    return hubbleToken;
  } catch (err) {
    console.error("Error fetching Hubble token:", err.response?.data || err.message);
    throw err;
  }
}
