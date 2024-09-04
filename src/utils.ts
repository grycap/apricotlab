import { KernelManager } from '@jupyterlab/services';

export async function executeKernelCommand(
  command: string,
  callback: (output: string) => void
): Promise<void> {
  try {
    const kernelManager = new KernelManager();
    const kernel = await kernelManager.startNew();
    const future = kernel.requestExecute({ code: command });

    future.onIOPub = msg => {
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
    const cmdIMClientPath = '%%bash\n' + 'which im_client.py';

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

export async function getInfrastructuresListPath(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Command to find the absolute path of infrastructuresList.json
    const cmd = `
      %%bash
      find "$(pwd)" -name "infrastructuresList.json" | head -n 1
    `;

    executeKernelCommand(cmd, output => {
      if (output.trim()) {
        resolve(output.trim());
      } else {
        reject(
          new Error(
            'Failed to find infrastructuresList.json. Maybe it is not in the project root.'
          )
        );
      }
    }).catch(reject);
  });
}

export async function getDeployedTemplatePath(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Command to find the absolute path of deployed-template.yaml
    const cmd = `
      %%bash
      find "$(pwd)" -name "deployed-template.yaml" | head -n 1
    `;

    executeKernelCommand(cmd, output => {
      if (output.trim()) {
        resolve(output.trim());
      } else {
        reject(
          new Error(
            'Failed to find deployed-template.yaml. Maybe it is not in the project root.'
          )
        );
      }
    }).catch(reject);
  });
}