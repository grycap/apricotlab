import { Dialog, Notification } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import {
  getOrStartKernel,
  getInfrastructuresListPath,
  getIMClientPath
} from './utils';

interface IInfrastructure {
  IMuser: string;
  IMpass: string;
  name: string;
  infrastructureID: string;
  id: string;
  type: string;
  host: string;
  tenant: string;
  user?: string;
  pass?: string;
  auth_version?: string;
  vo?: string;
  EGIToken?: string;
}

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
  const headerRow = table.insertRow();
  const headers = ['Name', 'ID', 'IP', 'State'];
  headers.forEach(header => {
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
                        cat "${infrastructuresListPath}"
                      `;
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
    throw new Error('Error creating table');
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

      // Fetch state and IP concurrently using the merged function
      const [state, ip] = await Promise.all([
        fetchInfrastructureData(kernel, infrastructure, stateCell, 'state'),
        fetchInfrastructureData(kernel, infrastructure, ipCell, 'ip')
      ]);

      // Update state and IP cells
      stateCell.textContent = state;
      ipCell.textContent = ip;
    })
  );
}

async function fetchInfrastructureData(
  kernel: any,
  infrastructure: IInfrastructure,
  cell: HTMLTableCellElement,
  dataType: 'state' | 'ip'
): Promise<string> {
  // Construct the command based on the type of data requested
  const cmd =
    dataType === 'state'
      ? await infrastructureState(infrastructure)
      : await infrastructureIP(infrastructure);

  return new Promise<string>(resolve => {
    cell.textContent = 'Loading...';
    const future = kernel.requestExecute({ code: cmd });

    future.onIOPub = (msg: any) => {
      const content = msg.content as any;
      const outputData =
        content.text || (content.data && content.data['text/plain']);

      // Ensure outputData is not undefined before resolving the promise
      if (outputData !== undefined) {
        let result: string;

        if (dataType === 'state') {
          // Extract the state from the output
          const stateWords = outputData.trim().split(' ');
          const stateIndex = stateWords.indexOf('state:');
          result =
            stateIndex !== -1 && stateIndex < stateWords.length - 1
              ? stateWords[stateIndex + 1].trim()
              : 'Error';
        } else {
          // dataType is 'ip'
          // Extract the IP from the output (get the last word)
          const ipWords = outputData.trim().split(' ');
          const ip = ipWords[ipWords.length - 1];
          result = ip ? ip : 'Error';
        }

        resolve(result);
      }
    };

    future.done.then(() => {
      // In case the onIOPub doesn't resolve the promise
      resolve('Error');
    });
  });
}

async function infrastructureState(
  infrastructure: IInfrastructure
): Promise<string> {
  const {
    IMuser,
    IMpass,
    infrastructureID,
    id,
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
  authContent += `id=${id}; type=${type}; host=${host};`;

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

              stateOut=$(python3 ${imClientPath} getstate ${infrastructureID} -r https://im.egi.eu/im -a $PWD/${pipeAuth})
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

  console.log('Get state command: ', cmd);
  return cmd;
}

async function infrastructureIP(
  infrastructure: IInfrastructure
): Promise<string> {
  const {
    IMuser,
    IMpass,
    infrastructureID,
    id,
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
  authContent += `id=${id}; type=${type}; host=${host};`;

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

              stateOut=$(python3 ${imClientPath} getvminfo ${infrastructureID} 0 net_interface.1.ip -r https://im.egi.eu/im -a $PWD/${pipeAuth})
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

  console.log('Get IP command: ', cmd);
  return cmd;
}

export { openListDeploymentsDialog };
