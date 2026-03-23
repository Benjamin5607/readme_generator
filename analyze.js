import axios from "axios";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

function parseRepoUrl(url) {
  const parts = url.split("/");
  return {
    owner: parts[3],
    repo: parts[4]
  };
}

async function getRepoTree(owner, repo) {
  const res = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`
  );
  return res.data.tree;
}

async function getFileContent(owner, repo, path) {
  const res = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
  );

  return Buffer.from(res.data.content, "base64").toString("utf-8");
}

function isValidFile(path) {
  return [".js", ".ts", ".py", ".md"].some(ext => path.endsWith(ext));
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

async function main() {
  const repoUrl = process.argv[2];
  const { owner, repo } = parseRepoUrl(repoUrl);

  console.log("📦 Fetching repo...");
  const tree = await getRepoTree(owner, repo);

  let code = "";

  for (const file of tree) {
    if (file.type !== "blob") continue;
    if (!isValidFile(file.path)) continue;

    try {
      const content = await getFileContent(owner, repo, file.path);
      code += `\n\n// FILE: ${file.path}\n${content}`;
    } catch (e) {
      console.log("skip:", file.path);
    }
  }

  code = code.slice(0, 12000);

  console.log("🧠 Running AI...");

  const prompt = `
Analyze this repository and return STRICT JSON:

{
  "readme": "Full README.md",
  "review": "Code review summary",
  "improvements": ["item1"]
}

Code:
${code}
`;

  const output = await callGroq(prompt);

  const json = JSON.parse(output);

  console.log("✅ Done");

  // 파일로 저장
  const fs = await import("fs");
  fs.writeFileSync("README.md", json.readme);
  fs.writeFileSync("review.txt", json.review);

  return json;
}

main();
