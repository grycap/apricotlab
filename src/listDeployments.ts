import { Dialog, Notification } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import {
  getOrStartKernel,
  getInfrastructuresListPath,
  getIMClientPath,
  createButton
} from './utils';

interface IInfrastructure {
  IMuser: string;
  IMpass: string;
  name: string;
  infrastructureID: string;
  hostId: string;
  type: string;
  host: string;
  tenant: string;
  user?: string;
  pass?: string;
  auth_version?: string;
  vo?: string;
  EGIToken?: string;
}

const imEndpoint = 'https://deploy.sandbox.eosc-beyond.eu';

async function openListDeploymentsDialog(): Promise<void> {
  try {
    // Create a loader container
    const loaderContainer = document.createElement('div');
    loaderContainer.classList.add('loader-container');

    const loader = document.createElement('div');
    loader.classList.add('loader');

    loaderContainer.appendChild(loader);

    // Create the dialog content
    const dialogContent = document.createElement('div');
    dialogContent.appendChild(loaderContainer);

    const contentWidget = new Widget({ node: dialogContent });
    const dialog = new Dialog({
      title: 'Deployments List',
      body: contentWidget,
      buttons: [Dialog.cancelButton()]
    });

    dialog.launch();

    const table = createTable();
    await populateTable(table);

    dialogContent.removeChild(loaderContainer);
    dialogContent.appendChild(table);
  } catch (error) {
    console.error('Error loading infrastructures list:', error);
    Notification.error(
      'Error loading infrastructures list. Check the console for more details.',
      {
        autoClose: 5000
      }
    );
  }
}

function createTable(): HTMLTableElement {
  const table = document.createElement('table');
  table.classList.add('deployments-table');

  // Create the header row
  const headers = ['Name', 'ID', 'IP', 'State', 'Action'];
  const headerRow = table.insertRow();
  headers.map(header => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });

  return table;
}

async function populateTable(table: HTMLTableElement): Promise<void> {
  let jsonData: string | null = null;
  const infrastructuresListPath = await getInfrastructuresListPath();

  const kernel = await getOrStartKernel();

  try {
    // Read infrastructuresList.json
    const cmdReadJson = `%%bash
                        cat "${infrastructuresListPath}"`;
    const futureReadJson = kernel.requestExecute({ code: cmdReadJson });

    futureReadJson.onIOPub = (msg: any) => {
      const content = msg.content as any;
      if (content && content.text) {
        jsonData = (jsonData || '') + content.text;
      }
    };

    await futureReadJson.done;

    if (!jsonData) {
      throw new Error('infrastructuresList.json does not exist in the path.');
    }
  } catch (error) {
    console.error('Error reading or parsing infrastructuresList.json:', error);
    Notification.error(
      'Error reading or parsing infrastructuresList.json. Check the console for more details.',
      {
        autoClose: 5000
      }
    );
  }

  // Parse the JSON data
  let infrastructures: IInfrastructure[] = [];
  try {
    if (jsonData) {
      infrastructures = JSON.parse(jsonData).infrastructures;
    }
  } catch (error) {
    console.error(
      'Error parsing JSON data from infrastructuresList.json:',
      error
    );
    Notification.error(
      'Error parsing JSON data from infrastructuresList.json. Check the console for more details.',
      {
        autoClose: 5000
      }
    );
    throw new Error('Error parsing JSON data');
  }

  // Populate the table rows and fetch IP and state for each infrastructure
  await Promise.all(
    infrastructures.map(async infrastructure => {
      const row = table.insertRow();
      const nameCell = row.insertCell();
      nameCell.textContent = infrastructure.name;
      const idCell = row.insertCell();
      idCell.textContent = infrastructure.infrastructureID;
      const ipCell = row.insertCell();
      const stateCell = row.insertCell();
      const actionCell = row.insertCell();

      // Fetch state and IP concurrently using the merged function
      try {
        const [state, ip] = await Promise.all([
          fetchInfrastructureData(kernel, infrastructure, stateCell, 'state'),
          fetchInfrastructureData(kernel, infrastructure, ipCell, 'ip')
        ]);

        // Update state and IP cells
        stateCell.textContent = state;
        ipCell.textContent = ip;
      } catch (error) {
        console.error(
          `Error fetching data for infrastructure ${infrastructure.name}:`,
          error
        );
        stateCell.textContent = 'Error';
        ipCell.textContent = 'Error';
      }

      // Create a Delete button inside the action column
      const deleteButton = createButton('Delete', async () => {
        const infrastructureId = infrastructure.infrastructureID;
        // const infrastructureName = infrastructure.name;

        const kernel = await getOrStartKernel();

        // Load the magics extension in the kernel
        const loadExtensionCmd = '%reload_ext apricot_magics';
        await kernel.requestExecute({ code: loadExtensionCmd }).done;

        // Create a loader element
        const loader = document.createElement('div');
        loader.className = 'mini-loader';
        deleteButton.textContent = '';
        deleteButton.appendChild(loader);

        try {
          const cmdDestroyInfra = `%apricot destroy ${infrastructureId}`;
          const futureDestroyInfra = kernel.requestExecute({
            code: cmdDestroyInfra
          });

          futureDestroyInfra.onIOPub = (msg: any) => {
            const content = msg.content as any;

            const outputData =
              content.text || (content.data && content.data['text/plain']);

            if (
              outputData &&
              outputData.includes('Infrastructure successfully destroyed')
            ) {
              row.remove();
              Notification.success(
                `Infrastructure ${infrastructureId} successfully destroyed.`,
                {
                  autoClose: 5000
                }
              );
            }
          };

          await futureDestroyInfra.done;
        } catch (error) {
          console.error('Error destroying infrastructure:', error);
          // Remove the loader and restore the button text
          deleteButton.removeChild(loader);
          deleteButton.textContent = 'Delete';
          Notification.error(
            'Error destroying infrastructure. Check the console for more details.',
            {
              autoClose: 5000
            }
          );
        }
      });

      actionCell.appendChild(deleteButton);
    })
  );
}

async function fetchInfrastructureData(
  kernel: any,
  infrastructure: IInfrastructure,
  cell: HTMLTableCellElement,
  dataType: 'state' | 'ip'
): Promise<string> {
  const cmd = await getInfrastructureInfo(infrastructure, dataType);

  return new Promise<string>(resolve => {
    // Execute the command through the kernel
    const future = kernel.requestExecute({ code: cmd });

    future.onIOPub = (msg: any) => {
      const content = msg.content as any;
      const outputData =
        content.text || (content.data && content.data['text/plain']);

      if (outputData && outputData.trim() !== '') {
        console.log(`Received output for ${dataType}:`, outputData);

        let result: string;

        // Check if the output contains "error" in the message
        if (outputData.toLowerCase().includes('error')) {
          result = 'Pending';
        } else {
          // Process output based on dataType if no error is present
          if (dataType === 'state') {
            const stateWords = outputData.trim().split(' ');
            const stateIndex = stateWords.indexOf('state:');
            result =
              stateIndex !== -1 && stateIndex < stateWords.length - 1
                ? stateWords[stateIndex + 1].trim()
                : 'Error';
          } else {
            // Extract IP from output for dataType 'ip'
            const ipWords = outputData.trim().split(' ');
            result = ipWords[ipWords.length - 1] || 'Error';
          }
        }

        resolve(result);
      }
    };
  });
}

async function getInfrastructureInfo(
  infrastructure: IInfrastructure,
  dataType: 'state' | 'ip'
): Promise<string> {
  const {
    IMuser,
    IMpass,
    infrastructureID,
    hostId,
    type,
    host,
    user = '',
    pass = '',
    tenant = '',
    auth_version = '',
    vo = '',
    EGIToken = ''
  } = infrastructure;

  const pipeAuth = 'auth-pipe';
  const imClientPath = await getIMClientPath();

  let authContent = `id=im; type=InfrastructureManager; username=${IMuser}; password=${IMpass};\n`;
  authContent += `id=${hostId}; type=${type}; host=${host};`;

  switch (type) {
    case 'OpenStack':
      authContent += ` username=${user}; password=${pass}; tenant=${tenant}; ${auth_version ? `auth_version=${auth_version};` : ''}`;
      break;
    case 'OpenNebula':
      authContent += ` username=${user}; password=${pass};`;
      break;
    case 'EC2':
      authContent += ` username=${user}; password=${pass};`;
      break;
    case 'EGI':
      authContent += ` vo=${vo}; token=${EGIToken};`;
      break;
    default:
      authContent += '';
  }

  const cmd = `%%bash
                PWD=$(pwd)
                # Remove pipes if they exist
                rm -f $PWD/${pipeAuth} &> /dev/null
                # Create pipes
                mkfifo $PWD/${pipeAuth}
                # Command to create the infrastructure manager client credentials
                echo -e "${authContent}" > $PWD/${pipeAuth} &

                if [ "${dataType}" = "state" ]; then
                    stateOut=$(python3 ${imClientPath} getstate ${infrastructureID} -r ${imEndpoint} -a $PWD/${pipeAuth})
                else
                    stateOut=$(python3 ${imClientPath} getvminfo ${infrastructureID} 0 net_interface.1.ip -r ${imEndpoint} -a $PWD/${pipeAuth})
                fi
                # Remove pipe
                rm -f $PWD/${pipeAuth} &> /dev/null
                # Print state output on stderr or stdout
                if [ $? -ne 0 ]; then
                    >&2 echo -e $stateOut
                    exit 1
                else
                    echo -e $stateOut
                fi
              `;

  console.log(`Get ${dataType} command: `, cmd);
  return cmd;
}

export { openListDeploymentsDialog };
