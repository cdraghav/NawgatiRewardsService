import axios from "axios";

let hubbleToken = null;

export async function getHubbleToken() {
  if (hubbleToken) return hubbleToken;

  try {
    const res = await axios.post(
      "https://api.dev.myhubble.money/v1/partners/auth/login",
      {
       clientId: 'navgati-LLVgVFHN',
  clientSecret: 'le00W49IfhHXHQVgRgaH8rkp5ya2zbpgdCRg0uZXO1XmsCt0lAoxigU72CSMlxpz',
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    hubbleToken = res.data.token

    if (!hubbleToken) {
      throw new Error("No access token returned from Hubble login");
    }

    setTimeout(() => {
      hubbleToken = null;
    }, 60 * 60 * 1000);

    return hubbleToken;
  } catch (err) {
    console.error("Error fetching Hubble token:", err.response?.data || err.message);
    throw err;
  }
}
