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
