
const jwt = require("jsonwebtoken");

const API_VERSION = "2026-03-10";

const createAppJwt = () => {
  const appId = process.env.GITHUB_APP_ID;
  const rawPrivateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !rawPrivateKey) {
    const error = new Error("GitHub App configuration is missing.");
    error.statusCode = 500;
    error.code = "GITHUB_CONFIG_MISSING";
    throw error;
  }

  const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 8 * 60,
      iss: appId,
    },
    privateKey,
    { algorithm: "RS256" }
  );
};

const createInstallationToken = async (
  installationId,
  repositoryIds
) => {
  const appJwt = createAppJwt();

  const body = {
    permissions: {
      contents: "read",
      metadata: "read",
    },
  };

  // Optionally restrict the token to specific repository IDs.
  if (repositoryIds?.length) {
    body.repository_ids = repositoryIds;
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data.message || "Failed to create GitHub installation token."
    );
    error.statusCode = response.status === 404 ? 404 : 502;
    error.code = "GITHUB_TOKEN_CREATION_FAILED";
    throw error;
  }

  return {
    token: data.token,
    expiresAt: data.expires_at,
  };
};

const listInstallationRepositories = async (installationId) => {
  const { token } = await createInstallationToken(installationId);

  const repositories = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": API_VERSION,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(
        data.message || "Failed to fetch GitHub repositories."
      );
      error.statusCode = 502;
      error.code = "GITHUB_REPOSITORIES_FETCH_FAILED";
      throw error;
    }

    repositories.push(
      ...data.repositories.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        htmlUrl: repo.html_url,
        cloneUrl: repo.clone_url,
        owner: repo.owner.login,
      }))
    );

    if (repositories.length >= data.total_count) break;
    page++;
  }

  return repositories;
};



const getInstallationDetails = async (installationId) => {
  const appJwt = createAppJwt();

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data.message || "Failed to verify GitHub installation."
    );

    error.statusCode = response.status === 404 ? 400 : 502;
    error.code = "GITHUB_INSTALLATION_VERIFICATION_FAILED";

    throw error;
  }

  if (String(data.app_id) !== String(process.env.GITHUB_APP_ID)) {
    const error = new Error(
      "Installation does not belong to the configured GitHub App."
    );

    error.statusCode = 400;
    error.code = "GITHUB_APP_MISMATCH";

    throw error;
  }

  return {
    installationId: data.id,
    accountId: data.account?.id,
    accountLogin: data.account?.login,
    accountType: data.target_type,
    repositorySelection: data.repository_selection,
    permissions: {
      contents: data.permissions?.contents || "read",
      metadata: data.permissions?.metadata || "read",
    },
    suspendedAt: data.suspended_at || null,
  };
};


module.exports = {
  createAppJwt,
  createInstallationToken,
  listInstallationRepositories,
  getInstallationDetails,
};
