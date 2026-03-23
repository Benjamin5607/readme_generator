import axios from "axios";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

function parseRepoUrl(url) {
  const parts = url.split("/");
  return {
    owner: parts[3],
    repo: parts[4]
  };
}

const allowedExt = [".js", ".ts", ".py", ".md"];

function isValidFile(path) {
  return allowedExt.some(ext => path.endsWith(ext));
}

async function getRepoTree(owner, repo, headers) {
  const res = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`,
    { headers }
  );
  return res.data.tree;
}

async function getFileContent(owner, repo, path, headers) {
  const res = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers }
  );

  return Buffer.from(res.data.content, "base64").toString("utf-8");
}

async function callGroq(prompt) {
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are a senior software architect." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return res.data.choices[0].message.content;
}

async function createBranch(owner, repo, headers) {
  const ref = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`,
    { headers }
  );

  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      ref: "refs/heads/ai-readme",
      sha: ref.data.object.sha
    },
    { headers }
  );
}

async function commitFile(owner, repo, content, headers) {
  await axios.put(
    `https://api.github.com/repos/${owner}/${repo}/contents/README.md`,
    {
      message: "🤖 AI generated README",
      content: Buffer.from(content).toString("base64"),
      branch: "ai-readme"
    },
    { headers }
  );
}

async function createPR(owner, repo, review, headers) {
  const pr = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      title: "🤖 AI README & Review",
      head: "ai-readme",
      base: "main",
      body: review
    },
    { headers }
  );

  return pr.data.number;
}

async function commentPR(owner, repo, prNumber, review, headers) {
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      body: "🤖 AI Review:\n\n" + review
    },
    { headers }
  );
}

async function main() {
  const repoUrl = process.argv[2];
  const githubToken = process.argv[3];

  const { owner, repo } = parseRepoUrl(repoUrl);

  const headers = {
    Authorization: `token ${githubToken}`
  };

  console.log("📦 Fetching repo...");
  const tree = await getRepoTree(owner, repo, headers);

  let code = "";

  for (const file of tree) {
    if (file.type !== "blob") continue;
    if (!isValidFile(file.path)) continue;

    try {
      const content = await getFileContent(owner, repo, file.path, headers);
      code += `\n\n// FILE: ${file.path}\n${content}`;
    } catch {
      console.log("skip:", file.path);
    }
  }

  code = code.slice(0, 12000);

  console.log("🧠 Running AI...");

  const prompt = `
Return STRICT JSON:

{
  "readme": "...",
  "review": "...",
  "improvements": []
}

Code:
${code}
`;

  const aiOutput = await callGroq(prompt);
  const json = JSON.parse(aiOutput);

  console.log("🌿 Creating branch...");
  await createBranch(owner, repo, headers);

  console.log("📝 Committing README...");
  await commitFile(owner, repo, json.readme, headers);

  console.log("🚀 Creating PR...");
  const prNumber = await createPR(owner, repo, json.review, headers);

  console.log("💬 Commenting...");
  await commentPR(owner, repo, prNumber, json.review, headers);

  console.log("✅ DONE 🎉");
}

main();
