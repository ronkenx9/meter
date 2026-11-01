import { AirwallexClient } from "../src/client.ts";

const awx = AirwallexClient.fromEnv();
await awx.login();
console.log(`token expires ${awx.tokenExpiresAt?.toISOString()}`);
console.log("AIRWALLEX_LOGIN_OK");
