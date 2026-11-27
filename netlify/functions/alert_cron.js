exports.config = {
  schedule: "*/2 * * * *"
};

exports.handler = async () => {
  const siteUrl =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL;
  if (!siteUrl) {
    return { statusCode: 200 };
  }
  try {
    await fetch(
      siteUrl +
      "/.netlify/functions/yahoo" +
      "?action=check_alerts"
    );
  } catch (e) {}
  return { statusCode: 200 };
};
