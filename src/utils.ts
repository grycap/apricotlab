import { KernelManager, ServerConnection } from '@jupyterlab/services';
import { Notification } from '@jupyterlab/apputils';

export const imEndpoint = 'https://im.egi.eu/im';
const hubTokenServicePath = 'services/share_manager/token';

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
  let timeout: ReturnType<typeof setTimeout>;

  return new Promise((resolve, reject) => {
    // Listen for output
    future.onIOPub = (msg: { content: any }) => {
      const content = msg.content;
      const currentOutput =
        content.text || (content.data && content.data['text/plain']);

      // If there is output, accumulate it
      if (currentOutput) {
        outputText += currentOutput;
        clearTimeout(timeout); // Reset timeout if data comes in early
        timeout = setTimeout(() => {
          resolve(outputText.trim()); // Resolve after a delay to ensure all data is received
        }, 500); // 500ms delay before resolving
      }
    };

    // Handle errors in command execution
    future.onFinished = (msg: { content: { status: string } }) => {
      if (msg.content.status !== 'ok') {
        reject(new Error(`Kernel execution failed: ${msg.content.status}`));
      }
    };
  });
}

function getHubTokenServiceUrls(): string[] {
  const origin = window.location.origin;
  const pathname = window.location.pathname;
  const urls = [new URL(`/${hubTokenServicePath}`, origin).toString()];

  const userPathIndex = pathname.indexOf('/user/');
  if (userPathIndex > 0) {
    const hubBasePath = pathname.slice(0, userPathIndex);
    urls.unshift(
      new URL(`${hubBasePath}/${hubTokenServicePath}`, origin).toString()
    );
  }

  return Array.from(new Set(urls));
}

function extractAccessToken(responseData: any): string {
  if (typeof responseData === 'string') {
    return responseData.trim();
  }

  return (
    responseData?.access_token ||
    responseData?.token ||
    responseData?.accessToken ||
    ''
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function acquireHubAccessToken(): Promise<string> {
  const serverSettings = ServerConnection.makeSettings();
  const browserToken = serverSettings.token;

  if (!browserToken) {
    return '';
  }

  for (const tokenUrl of getHubTokenServiceUrls()) {
    try {
      const response = await fetch(tokenUrl, {
        method: 'GET',
        headers: {
          Authorization: `bearer ${browserToken}`,
          Accept: 'application/json'
        },
        credentials: 'same-origin'
      });

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const responseData = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      const accessToken = extractAccessToken(responseData);

      if (accessToken) {
        return accessToken;
      }
    } catch (error) {
      console.warn(`Failed to acquire token from ${tokenUrl}:`, error);
    }
  }

  return '';
}

export async function refreshIMAuthTokenFromHub(): Promise<string> {
  const accessToken = await acquireHubAccessToken();

  if (!accessToken) {
    return '';
  }

  const authFilePath = await getAuthFilePath();
  const cmd = `%%bash
PWD=$(pwd)
auth_file="$PWD"/${shellQuote(authFilePath)}
token=${shellQuote(accessToken)}
tmp_file="$auth_file.tmp"
im_line="id = im; type = InfrastructureManager; token = $token;"

if [ -f "$auth_file" ] && grep -q '^id[[:space:]]*=[[:space:]]*im[[:space:]]*;' "$auth_file"; then
  awk -v im_line="$im_line" '
    /^id[[:space:]]*=[[:space:]]*im[[:space:]]*;/ { print im_line; next }
    { print }
  ' "$auth_file" > "$tmp_file"
else
  printf '%s\\n' "$im_line" > "$tmp_file"
  if [ -f "$auth_file" ]; then
    cat "$auth_file" >> "$tmp_file"
  fi
fi

mv "$tmp_file" "$auth_file"
echo "IM auth token refreshed"
`;

  try {
    await executeKernelCommand(cmd);
    return accessToken;
  } catch (error) {
    console.warn('Failed to refresh IM auth token from JupyterHub:', error);
    return '';
  }
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

export async function getIMClientPath(): Promise<string> {
  const cmdIMClientPath = `
    %%bash
    which im_client.py
  `;
  return getPath(
    cmdIMClientPath,
    'Failed to find im_client.py path. Maybe IM-client is not installed. Check the console for more details.'
  );
}

export async function getDeployedTemplatePath(
  ext: 'yaml' | 'json' | 'radl'
): Promise<string> {
  const cmdDeployedTemplatePath = `
    %%bash
    realpath --relative-to="$(pwd)" resources/deployed-template.${ext}
  `;
  return getPath(
    cmdDeployedTemplatePath,
    `Failed to find resources/deployed-template.${ext}. Maybe it is not in the resources folder. Check the console for more details.`
  );
}

export async function getInfrastructuresListPath(): Promise<string> {
  const cmdInfrastructuresListPath = `
    %%bash
    realpath --relative-to="$(pwd)" resources/infrastructuresList.json
  `;
  return getPath(
    cmdInfrastructuresListPath,
    'Failed to find resources/infrastructuresList.json. Maybe it is not in the resources folder. Check the console for more details.'
  );
}

export async function getDeployableTemplatesPath(): Promise<string> {
  const cmdTemplatesPath = `
    %%bash
    realpath --relative-to="$(pwd)" resources/deployable_templates
  `;
  return getPath(
    cmdTemplatesPath,
    'Failed to find resources/deployable_templates/ directory. Maybe it is not in the project folder. Check the console for more details.'
  );
}

export async function getAuthFilePath(): Promise<string> {
  const cmdTemplatesPath = `
    %%bash
    realpath --relative-to="$(pwd)" resources/authfile
  `;
  return getPath(
    cmdTemplatesPath,
    'Failed to find resources/authfile directory. Maybe it is not in the project folder. Check the console for more details.'
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
