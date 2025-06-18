import { Config } from "../models/Config";
import { Item } from "../models/Item";

async function fetchRepoContents(config: Config, fetchUrl: string, repo: string): Promise<Response> {
  const headers: HeadersInit = {};
  if (config.connector.accessToken) {
    headers["Authorization"] = `Bearer ${config.connector.accessToken}`;
    headers["Accept"] = "application/vnd.github.v3+json";
  }
  const response = await fetch(fetchUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch contents from repo ${repo}: ${response.statusText}`);
  }
  return response;
}

async function cleanMarkdownContent(rawContent: string): Promise<string> {
  // Remove the "value" wrapper and unescape newlines
  let content = rawContent
    .replace('"value": "', '')
    .replace(/\\n/g, '\n')
    .replace(/^"|"$/g, ''); // Remove starting and ending quotes

  // Remove markdown formatting
  content = content
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove headers
    .replace(/#{1,6}\s/g, '')
    // Remove emphasis
    .replace(/\*\*/g, '')
    // Remove bullet points
    .replace(/- /g, '')
    // Remove links
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    // Remove tables
    .replace(/\|.*\|[\r\n]/g, '')
    // Remove horizontal rules
    .replace(/---/g, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove multiple empty lines
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    // Trim whitespace
    .trim();

  return content;
}

// Update the mapFileToItem function to use the cleaned content
async function mapFileToItem(config: Config, file: any, owner: string, repo: string): Promise<Item> {
  const rawContent = await Buffer.from(file.content, 'base64').toString('utf-8');
  const cleanedContent = await cleanMarkdownContent(rawContent);
  
  return {
    id: file.sha,
    issueNumber: file.path,
    owner: owner,
    repo: repo,
    assignedTo: "",
    state: "open",
    lastModified: new Date(Date.now()).toISOString().slice(0, -5) + "Z",
    title: file.name,
    abstract: `Markdown file: ${file.path}`,
    author: "",
    content: cleanedContent,
    url: file.html_url,
  };
}


export async function* getAllMdFiles(config: Config): AsyncGenerator<Item> {
  const repos = config.connector.repos.split(",");
  
  for (const repo of repos) {
    config.context.log(`Fetching readme.md files from agent-instructions folders: ${repo}`);
    const [owner, repoName] = repo.trim().split("/");
    
    const fetchUrl = `https://api.github.com/repos/${repo}/contents/samples/agent-instructions`;
    
    try {
      const response = await fetchRepoContents(config, fetchUrl, repo);
      const contents = await response.json();
      
      // Process files and directories recursively
      async function* processContents(items: any[]): AsyncGenerator<Item> {
        try {
          if (!Array.isArray(items)) {
            throw new Error('Expected array of items but received: ' + typeof items);
          }

          // Process all directories (removed the slice(0,5) limit)
          const directories = items.filter(item => item.type === "dir");

          for (const dir of directories) {
            try {
              // Fetch readme.md directly from each agent folder
               const readmeUrl = `https://api.github.com/repos/${repo}/contents/${dir.path}/readme.md`;
         try {
                const readmeResponse = await fetchRepoContents(config, readmeUrl, repo);
                const readmeContent = await readmeResponse.json();
                
                if (readmeContent) {
                  yield await mapFileToItem(config, {
                    ...readmeContent,
                    name: 'readme.md',
                    path: `${dir.path}/readme.md`
                  }, owner, repoName);
                }
              } catch (readmeError) {
                 config.context.log(`No readme found in ${dir.path} with issue 1: ${readmeError.message}`);
                // Try with uppercase README.md if lowercase fails
               const uppercaseReadmeUrl = `https://api.github.com/repos/${repo}/contents/${dir.path}/README.md`;
             try {
                  const readmeResponse = await fetchRepoContents(config, uppercaseReadmeUrl, repo);
                  const readmeContent = await readmeResponse.json();
                  
                  if (readmeContent) {
                    yield await mapFileToItem(config, {
                      ...readmeContent,
                      name: 'README.md',
                      path: `${dir.path}/README.md`
                    }, owner, repoName);
                  }
                } catch (uppercaseReadmeError) {
                  config.context.log(`No readme found in ${dir.path} with issue: ${uppercaseReadmeError.message}`);
                }
              }
            } catch (dirError) {
              config.context.log(`Error processing folder ${dir.path}: ${dirError.message}`);
              continue;
            }
          }
        } catch (error) {
          config.context.log(`Error in processContents: ${error.message}`);
          return;
        }
      }

      yield* processContents(contents);
    } catch (error) {
      config.context.log(`Sample folder not found in repo ${repo} or access denied: ${error.message}`);
      continue;
    }
  }
}