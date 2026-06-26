import {
  ContentsManager,
  KernelManager,
  ServerConnection
} from '@jupyterlab/services';
import { Notification } from '@jupyterlab/apputils';

const infrastructuresStateDir = 'apricotlab_state';
const infrastructuresStatePath = `${infrastructuresStateDir}/infrastructuresList.json`;
const authFileStatePath = `${infrastructuresStateDir}/authfile`;
const defaultAuthFileContent =
  'id = im; type = InfrastructureManager; token = <token>\n';

let kernelManager: KernelManager | null = null;
let kernel: any | null = null;
const contentsManager = new ContentsManager();

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

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
  try {
    await withTimeout(
      contentsManager.get(infrastructuresStateDir, { content: false }),
      5000,
      `Timeout reading ${infrastructuresStateDir}`
    );
  } catch (error) {
    const settings = ServerConnection.makeSettings();
    const baseUrl = settings.baseUrl.endsWith('/')
      ? settings.baseUrl
      : `${settings.baseUrl}/`;
    const stateDirUrl = `${baseUrl}api/contents/${encodeURIComponent(
      infrastructuresStateDir
    )}`;

    const response = await withTimeout(
      ServerConnection.makeRequest(
        stateDirUrl,
        {
          method: 'PUT',
          body: JSON.stringify({ type: 'directory' }),
          headers: { 'Content-Type': 'application/json' }
        },
        settings
      ),
      5000,
      `Timeout creating ${infrastructuresStateDir}`
    );

    if (!response.ok && response.status !== 409) {
      throw new Error(
        `Failed to create ${infrastructuresStateDir}: ${response.status} ${response.statusText}`
      );
    }
  }
}

async function writeInfrastructuresList(data: any): Promise<void> {
  await ensureInfrastructuresStateDir();
  await withTimeout(
    contentsManager.save(infrastructuresStatePath, {
      type: 'file',
      format: 'text',
      content: JSON.stringify(data, null, 2)
    }),
    5000,
    `Timeout writing ${infrastructuresStatePath}`
  );
}

export async function readInfrastructuresList(): Promise<any> {
  try {
    const file = await withTimeout(
      contentsManager.get(infrastructuresStatePath, {
        content: true
      }),
      5000,
      `Timeout reading ${infrastructuresStatePath}`
    );
    const data =
      typeof file.content === 'string'
        ? JSON.parse(file.content)
        : file.content;

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
  await withTimeout(
    contentsManager.save(authFileStatePath, {
      type: 'file',
      format: 'text',
      content
    }),
    5000,
    `Timeout writing ${authFileStatePath}`
  );
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await withTimeout(
    contentsManager.save(path, {
      type: 'file',
      format: 'text',
      content
    }),
    5000,
    `Timeout writing ${path}`
  );
}

export async function readAuthFile(): Promise<string> {
  try {
    const file = await withTimeout(
      contentsManager.get(authFileStatePath, {
        content: true
      }),
      5000,
      `Timeout reading ${authFileStatePath}`
    );
    const content = typeof file.content === 'string' ? file.content : '';

    if (content) {
      return content;
    }
  } catch {
    // Missing authfile is expected on a fresh workspace.
  }

  await writeAuthFile(defaultAuthFileContent);
  return defaultAuthFileContent;
}

function getStatePathCommand(statePath: string): string {
  return `
from pathlib import Path
import os

state = Path(${JSON.stringify(statePath)})
candidates = [
    Path.cwd() / state,
    Path.cwd().parent / state,
    Path.home() / state,
]

for candidate in candidates:
    if candidate.exists():
        print(os.path.relpath(candidate.resolve(), Path.cwd().resolve()))
        break
else:
    target = Path.home() / state
    print(os.path.relpath(target, Path.cwd().resolve()))
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
  return `resources/deployed-template.${ext}`;
}

export async function getInfrastructuresListPath(): Promise<string> {
  await readInfrastructuresList();
  const cmdInfrastructuresListPath = getStatePathCommand(
    infrastructuresStatePath
  );
  return getPath(
    cmdInfrastructuresListPath,
    'Failed to find apricotlab_state/infrastructuresList.json. Check the console for more details.'
  );
}

export async function getDeployableTemplatesPath(): Promise<string> {
  return 'resources/deployable_templates';
}

export async function getAuthFilePath(): Promise<string> {
  await readAuthFile();
  const cmdTemplatesPath = getStatePathCommand(authFileStatePath);
  return getPath(
    cmdTemplatesPath,
    'Failed to find apricotlab_state/authfile. Check the console for more details.'
  );
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
