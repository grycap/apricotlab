import { KernelManager } from '@jupyterlab/services';
import { Notification } from '@jupyterlab/apputils';

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
  let timeout: NodeJS.Timeout;

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
