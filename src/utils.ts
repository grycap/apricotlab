import { KernelManager } from '@jupyterlab/services';
import { Notification } from '@jupyterlab/apputils';

const infrastructuresStateDir = 'apricotlab_state';
const infrastructuresStatePath = `${infrastructuresStateDir}/infrastructuresList.json`;
const authFileStatePath = `${infrastructuresStateDir}/authfile`;
const defaultAuthFileContent =
  'id = im; type = InfrastructureManager; token = <token>\n';

let kernelManager: KernelManager | null = null;
let kernel: any | null = null;

// Get or start a new kernel (reused across all executions)
export async function getOrStartKernel() {
  if (!kernelManager || !kernel) {
    kernelManager = new KernelManager();
    kernel = await kernelManager.startNew();
  }
  return kernel;
}

export async function executeKernelCommand(command: string): Promise<string> {
  const kernelInstance = await getOrStartKernel();
  const future = kernelInstance.requestExecute({ code: command });

  let outputText = '';

  return new Promise((resolve, reject) => {
    // Listen for output
    future.onIOPub = (msg: { content: any }) => {
      const content = msg.content;
      const currentOutput =
        content.text ||
        content.evalue ||
        (content.data && content.data['text/plain']);

      // If there is output, accumulate it
      if (currentOutput) {
        outputText += currentOutput;
      }
    };

    future.done
      .then((msg: { content: { status: string } }) => {
        if (msg.content.status !== 'ok') {
          reject(
            new Error(
              outputText || `Kernel execution failed: ${msg.content.status}`
            )
          );
          return;
        }

        setTimeout(() => {
          resolve(outputText.trim());
        }, 100);
      })
      .catch((error: Error) => {
        reject(error);
      });
  });
}

async function getPath(
  command: string,
  notificationMessage: string
): Promise<string> {
  try {
    return await executeKernelCommand(command);
  } catch (error) {
    Notification.error(notificationMessage, {
      autoClose: 5000
    });
    console.error((error as Error).message);
    throw error;
  }
}

async function ensureInfrastructuresStateDir(): Promise<void> {
  const cmd = `
from pathlib import Path
import shutil

state_name = ${JSON.stringify(infrastructuresStateDir)}
state_dir = Path.home() / state_name
state_dir.mkdir(exist_ok=True)

for legacy_dir in (Path.cwd() / state_name, Path.cwd().parent / state_name):
    if legacy_dir.exists() and legacy_dir.resolve() != state_dir.resolve():
        for legacy_file in legacy_dir.iterdir():
            target = state_dir / legacy_file.name
            if legacy_file.is_file() and not target.exists():
                shutil.copy2(legacy_file, target)
  `;
  await executeKernelCommand(cmd);
}

async function writeInfrastructuresList(data: any): Promise<void> {
  await ensureInfrastructuresStateDir();
  const cmd = `
from pathlib import Path

path = Path.home() / ${JSON.stringify(infrastructuresStatePath)}
path.write_text(${JSON.stringify(JSON.stringify(data, null, 2))})
  `;
  await executeKernelCommand(cmd);
}

export async function readInfrastructuresList(): Promise<any> {
  try {
    await ensureInfrastructuresStateDir();
    const cmd = `
from pathlib import Path
import json

path = Path.home() / ${JSON.stringify(infrastructuresStatePath)}
if not path.exists():
    path.write_text(json.dumps({"refresh_token": "", "infrastructures": []}, indent=2))
print(path.read_text())
    `;
    const content = await executeKernelCommand(cmd);
    const data = JSON.parse(content);

    return {
      refresh_token: data?.refresh_token || '',
      infrastructures: data?.infrastructures || []
    };
  } catch (error) {
    console.warn(
      `${infrastructuresStatePath} not found or unreadable. Creating an empty list.`,
      error
    );
    const initialData = {
      refresh_token: '',
      infrastructures: []
    };
    await writeInfrastructuresList(initialData);
    return initialData;
  }
}

export async function appendInfrastructureToList(
  infrastructure: any
): Promise<void> {
  const data = await readInfrastructuresList();
  data.infrastructures = [...(data.infrastructures || []), infrastructure];
  await writeInfrastructuresList(data);
}

export async function removeInfrastructureFromList(
  infrastructureID: string
): Promise<void> {
  const data = await readInfrastructuresList();
  data.infrastructures = (data.infrastructures || []).filter(
    (infrastructure: any) =>
      infrastructure.infrastructureID !== infrastructureID
  );
  await writeInfrastructuresList(data);
}

export async function writeAuthFile(content: string): Promise<void> {
  await ensureInfrastructuresStateDir();
  const cmd = `
from pathlib import Path

path = Path.home() / ${JSON.stringify(authFileStatePath)}
path.write_text(${JSON.stringify(content)})
  `;
  await executeKernelCommand(cmd);
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  const cmd = `
from pathlib import Path

path = Path.home() / Path(${JSON.stringify(path)})
path.parent.mkdir(exist_ok=True)
path.write_text(${JSON.stringify(content)})
  `;
  await executeKernelCommand(cmd);
}

export async function readAuthFile(): Promise<string> {
  try {
    await ensureInfrastructuresStateDir();
    const cmd = `
from pathlib import Path

path = Path.home() / ${JSON.stringify(authFileStatePath)}
print(path.read_text() if path.exists() else "")
    `;
    const content = await executeKernelCommand(cmd);

    if (content) {
      return content;
    }
  } catch {
    // Missing authfile is expected on a fresh workspace.
  }

  await writeAuthFile(defaultAuthFileContent);
  return defaultAuthFileContent;
}

export function getBrowserToken(): string {
  const jupyterConfigElement = document.querySelector('#jupyter-config-data');
  const jupyterConfig = jupyterConfigElement
    ? JSON.parse(jupyterConfigElement.innerHTML)
    : {};

  return jupyterConfig.token || '';
}

function extractAccessToken(payload: any): string {
  if (typeof payload === 'string') {
    return payload.trim();
  }

  return (
    payload?.access_token ||
    payload?.accessToken ||
    payload?.token ||
    payload?.data?.access_token ||
    ''
  );
}

export async function getAccessTokenFromShareManager(): Promise<string> {
  const browserToken = getBrowserToken();

  if (!browserToken) {
    throw new Error('Jupyter browser token not found.');
  }

  const response = await fetch(
    'https://notebooks.egi.eu/services/share-manager/token',
    {
      headers: {
        Authorization: `bearer ${browserToken}`
      }
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(responseText || `${response.status} ${response.statusText}`);
  }

  let payload: any = responseText.trim();
  try {
    payload = JSON.parse(responseText);
  } catch {
    // The endpoint may return the token as plain text.
  }

  const accessToken = extractAccessToken(payload);

  if (!accessToken) {
    throw new Error('Share-manager response did not include an access token.');
  }

  return accessToken;
}

export function buildAuthFileContent(obj: {
  accessToken?: string;
  imAccessToken?: string;
  id: string;
  deploymentType?: string;
  type?: string;
  host: string;
  username?: string;
  user?: string;
  password?: string;
  pass?: string;
  tenant?: string;
  authVersion?: string;
  domain?: string;
  vo?: string;
}): string {
  const deploymentType = obj.deploymentType || obj.type || '';
  const username = obj.username || obj.user || '';
  const password = obj.password || obj.pass || '';
  const imAccessToken = obj.imAccessToken || obj.accessToken || '';
  let authContent = `id = im; type = InfrastructureManager; token = ${imAccessToken};\n`;
  authContent += `id = ${obj.id}; type = ${deploymentType}; host = ${obj.host}; `;

  if (deploymentType === 'OpenNebula') {
    authContent += ` username = ${username}; password = ${password};`;
  } else if (deploymentType === 'OpenStack') {
    authContent += `username = ${username}; password = ${password}; tenant = ${obj.tenant || ''}; auth_version = ${obj.authVersion || ''}; domain = ${obj.domain || ''}`;
  } else if (deploymentType === 'EGI') {
    authContent += ` vo = ${obj.vo || ''}; token = ${obj.accessToken || ''}`;
  }
  authContent += '\n';

  return authContent;
}

export async function persistAuthFile(obj: {
  accessToken?: string;
  imAccessToken?: string;
  id: string;
  deploymentType?: string;
  type?: string;
  host: string;
  username?: string;
  user?: string;
  password?: string;
  pass?: string;
  tenant?: string;
  authVersion?: string;
  domain?: string;
  vo?: string;
}): Promise<void> {
  await writeAuthFile(buildAuthFileContent(obj));
}

function getStatePathCommand(statePath: string): string {
  return `
from pathlib import Path

state = Path(${JSON.stringify(statePath)})
print(Path.home() / state)
  `;
}

export async function getIMClientPath(): Promise<string> {
  const cmdIMClientPath = `
from pathlib import Path
import shutil

candidates = [
    shutil.which("im_client.py"),
    shutil.which("im_client"),
]

for candidate in candidates:
    if candidate and Path(candidate).exists():
        print(candidate)
        break
else:
    raise FileNotFoundError("Could not find im_client.py")
  `;
  return getPath(
    cmdIMClientPath,
    'Failed to find im_client.py path. Maybe IM-client is not installed. Check the console for more details.'
  );
}

export async function getDeployedTemplatePath(
  ext: 'yaml' | 'json' | 'radl'
): Promise<string> {
  await ensureInfrastructuresStateDir();
  return `${infrastructuresStateDir}/deployed-template.${ext}`;
}

export async function getStateFilePath(fileName: string): Promise<string> {
  await ensureInfrastructuresStateDir();
  const cmdStateFilePath = getStatePathCommand(
    `${infrastructuresStateDir}/${fileName}`
  );
  return getPath(
    cmdStateFilePath,
    `Failed to find ${infrastructuresStateDir}/${fileName}. Check the console for more details.`
  );
}

export async function getInfrastructuresListPath(): Promise<string> {
  await readInfrastructuresList();
  return getStateFilePath('infrastructuresList.json');
}

export async function getDeployableTemplatesPath(): Promise<string> {
  return 'resources/deployable_templates';
}

export async function getAuthFilePath(): Promise<string> {
  await readAuthFile();
  return getStateFilePath('authfile');
}

export const createButton = (
  label: string,
  onClick: () => void
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = 'jp-Button';

  // Add footer-button class for specific buttons
  if (['Back', 'Next', 'Deploy'].includes(label)) {
    button.classList.add('footer-button');
  }

  if (label === 'Delete') {
    button.classList.add('jp-mod-styled', 'jp-mod-warn');
  }

  button.addEventListener('click', onClick);
  return button;
};
