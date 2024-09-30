import { KernelManager } from '@jupyterlab/services';

let kernelManager: KernelManager | null = null;
let kernel: any | null = null;

// Get or start a new kernel (reused across all executions)
async function getOrStartKernel() {
  if (!kernelManager || !kernel) {
    kernelManager = new KernelManager();
    kernel = await kernelManager.startNew();
  }
  return kernel;
}

export async function executeKernelCommand(
  command: string,
  callback: (output: string) => void
): Promise<void> {
  try {
    const kernel = await getOrStartKernel();
    const future = kernel.requestExecute({ code: command });

    future.onIOPub = (msg: any) => {
      const content = msg.content as any;
      const outputText =
        content.text || (content.data && content.data['text/plain']);
      callback(outputText);
    };
  } catch (error) {
    console.error('Error executing kernel command:', error);
  }
}

export async function getIMClientPath(): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmdIMClientPath = `
      %%bash
      which im_client.py
    `;

    executeKernelCommand(cmdIMClientPath, output => {
      if (output.trim()) {
        resolve(output.trim());
      } else {
        reject(
          new Error(
            'Failed to find im_client.py path. Maybe IM-client is not installed.'
          )
        );
      }
    }).catch(reject);
  });
}

export async function getDeployedTemplatePath(): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmdDeployedTemplatePath = `
      %%bash
      realpath --relative-to="$(pwd)" resources/deployed-template.yaml
    `;

    executeKernelCommand(cmdDeployedTemplatePath, output => {
      if (output.trim()) {
        resolve(output.trim());
      } else {
        reject(
          new Error(
            'Failed to find deployed-template.yaml. Maybe it is not in the resources folder.'
          )
        );
      }
    }).catch(reject);
  });
}

export async function getInfrastructuresListPath(): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmdInfrastructuresListPath = `
      %%bash
      realpath --relative-to="$(pwd)" resources/infrastructuresList.json
    `;

    executeKernelCommand(cmdInfrastructuresListPath, output => {
      if (output.trim()) {
        resolve(output.trim());
      } else {
        reject(
          new Error(
            'Failed to find infrastructuresList.json. Maybe it is not in the resources folder.'
          )
        );
      }
    }).catch(reject);
  });
}

export async function getDeployableTemplatesPath(): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmdTemplatesPath = `
      %%bash
      realpath --relative-to="$(pwd)" resources/deployable_templates
    `;

    executeKernelCommand(cmdTemplatesPath, output => {
      if (output.trim()) {
        resolve(output.trim());
      } else {
        reject(
          new Error(
            'Failed to find templates/ directory. Maybe it is not in the project folder.'
          )
        );
      }
    }).catch(reject);
  });
}
