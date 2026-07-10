import env from "~/env";

/**
 * True if the current installation is the cloud hosted version at getdarin.com
 */
const isCloudHosted = [
  "https://app.getdarin.com",
  "https://app.darin.dev",
  "https://app.darin.dev:3000",
].includes(env.URL);

export default isCloudHosted;
