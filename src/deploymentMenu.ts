import * as jsyaml from 'js-yaml';
import { ContentsManager } from '@jupyterlab/services';
import { KernelManager } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';
import { Dialog } from '@jupyterlab/apputils';
import { executeKernelCommand, getIMClientPath, getInfrastructuresListPath, getDeployedTemplatePath } from './utils';

interface IDeployInfo {
  IMuser: string;
  IMpass: string;
  recipe: string;
  id: string;
  deploymentType: string;
  host: string;
  tenant: string;
  username: string;
  password: string;
  port: string;
  infName: string;
  authVersion: string;
  domain: string;
  vo: string;
  EGIToken: any;
  worker: {
    num_instances: number;
    num_cpus: number;
    mem_size: string;
    disk_size: string;
    num_gpus: number;
    image: string;
    [key: string]: number | string;
  };
  childs: string[];
}

interface ITemplateInput {
  type: string;
  description: string;
  default: any;
  value?: any;
}

type UserInput = {
  name: string;
  inputs: {
    [key: string]: {
      description: string;
      default: any;
      value: any;
    };
  };
  nodeTemplates: any;
  outputs: any;
};

interface IInfrastructureData {
  IMuser: string;
  IMpass: string;
  name: string;
  infrastructureID: string;
  id: string;
  type: string;
  host: string;
  tenant: string;
  user: string;
  pass: string;
  authVersion: string;
  domain: string;
  vo: string;
  EGIToken: string;
}

const deployInfo: IDeployInfo = {
  IMuser: '',
  IMpass: '',
  recipe: '',
  id: '',
  deploymentType: '',
  host: '',
  tenant: '',
  username: '',
  password: '',
  port: '',
  infName: 'infra-name',
  authVersion: '',
  domain: '',
  vo: '',
  EGIToken: '',
  worker: {
    num_instances: 1,
    num_cpus: 1,
    mem_size: '2 GB',
    disk_size: '20 GB',
    num_gpus: 1,
    image: ''
  },
  childs: []
};

let imageOptions: { uri: string; name: string }[] = [];

let deploying = false; // Flag to prevent multiple deployments at the same time
let imClientPath: string;
let infrastructuresListPath: string;
let deployedTemplatesPath: string;

//*****************//
//* Aux functions *//
//*****************//

async function openDeploymentDialog(): Promise<void> {
  // Create a container element for the dialog content
  const dialogContent = document.createElement('div');

  // Call deployChooseProvider to append buttons to dialogContent
  deployChooseProvider(dialogContent);

  // Create a widget from the dialog content
  const contentWidget = new Widget({ node: dialogContent });

  const dialog = new Dialog({
    title: 'Deploy Infrastructure',
    body: contentWidget,
    buttons: []
  });

  // Handle form submission
  dialog.launch().then(result => {
    // Logic to handle form submission
    console.log('Form submitted');
  });
}

const createButton = (
  label: string,
  onClick: () => void
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', onClick);
  // Set an id for the "Next" button
  if (label === 'Next') {
    button.id = 'nextButton';
  }
  return button;
};

const clearDialogElements = (dialogBody: HTMLElement): void => {
  Array.from(dialogBody.children).forEach(child => {
    if (
      !child.classList.contains('recipe-button') &&
      !child.classList.contains('back-button')
    ) {
      dialogBody.removeChild(child);
    }
  });
};

const addFormInput = (
  form: HTMLFormElement,
  labelText: string,
  inputId: string,
  value: string = '',
  type: string = 'text',
  p0?: string
): void => {
  const label = document.createElement('label');
  label.textContent = labelText;
  form.appendChild(label);

  const input = document.createElement('input');
  input.type = type;
  input.id = inputId;
  input.value = value;
  form.appendChild(input);

  form.appendChild(document.createElement('br'));
};

function getInputValue(inputId: string): string {
  const input = document.getElementById(inputId) as HTMLInputElement;
  return input.value;
}

async function computeHash(input: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

async function generateIMCredentials(): Promise<void> {
  const randomInput = `${Date.now()}-${Math.random()}`;
  const hash = await computeHash(randomInput);
  // Use first 16 characters for user and next 16 characters for password
  const user = hash.substring(0, 16);
  const pass = hash.substring(16, 32);
  deployInfo.IMuser = user;
  deployInfo.IMpass = pass;
}

async function createImagesDropdown(
  output: string | undefined,
  dialogBody: HTMLElement
) {
  if (!output) {
    console.error('Output is empty or undefined.');
    return;
  }

  console.log('Images:', output);

  // Check if the output contains "error" in the message
  if (output.toLowerCase().includes('error')) {
    alert(output);
  }

  // Find the first occurrence of '[' and get the substring from there
  const jsonStartIndex = output.indexOf('[');
  if (jsonStartIndex === -1) {
    console.error('No OS images available.');
    return;
  }

  const jsonOutput = output.substring(jsonStartIndex).trim();
  console.log('JSON output:', jsonOutput);

  try {
    const images: { uri: string; name: string }[] = JSON.parse(jsonOutput);
    imageOptions = images;
    console.log('Parsed images:', images);

    // Create dropdown menu with image options
    const select = document.createElement('select');
    select.id = 'imageDropdown';

    imageOptions.forEach(image => {
      const option = document.createElement('option');
      option.value = image.uri;
      option.textContent = image.name;
      select.appendChild(option);
    });

    dialogBody.appendChild(select);
  } catch (error) {
    console.error('Error getting OS images:', error);
  }
}

async function mergeTOSCARecipes(
  parsedConstantTemplate: any,
  userInputs: UserInput[] | undefined,
  nodeTemplates: any[] | undefined,
  outputs: any[] | undefined
): Promise<any> {
  try {
    // Clone the parsed constant template to avoid mutating the original
    const mergedTemplate = JSON.parse(JSON.stringify(parsedConstantTemplate));

    // Process user inputs if defined and not empty
    if (userInputs && userInputs.length > 0) {
      const populatedTemplates = await Promise.all(userInputs);

      // Ensure populatedTemplates is not undefined
      if (populatedTemplates) {
        populatedTemplates.forEach(template => {
          if (template && template.inputs) {
            Object.entries(template.inputs).forEach(([inputName, input]) => {
              if (typeof input === 'object' && input !== null) {
                const inputValue = (input as ITemplateInput).value;

                console.log(
                  'Merging input:',
                  inputName,
                  'with value:',
                  inputValue
                );

                // Merge or add inputs in the constant template
                if (inputName in mergedTemplate.topology_template.inputs) {
                  mergedTemplate.topology_template.inputs[inputName].default =
                    inputValue;
                } else {
                  mergedTemplate.topology_template.inputs = {
                    ...mergedTemplate.topology_template.inputs,
                    [inputName]: {
                      type: 'string',
                      description: inputName,
                      default: inputValue
                    }
                  };
                }
              }
            });
          }

          // Merge node templates
          if (template.nodeTemplates) {
            Object.entries(template.nodeTemplates).forEach(
              ([nodeTemplateName, nodeTemplate]) => {
                mergedTemplate.topology_template.node_templates = {
                  ...mergedTemplate.topology_template.node_templates,
                  [nodeTemplateName]: nodeTemplate
                };
              }
            );
          }

          // Merge outputs
          if (template.outputs) {
            Object.entries(template.outputs).forEach(([outputName, output]) => {
              mergedTemplate.topology_template.outputs = {
                ...mergedTemplate.topology_template.outputs,
                [outputName]: output
              };
            });
          }
        });
      }
    }

    return mergedTemplate;
  } catch (error) {
    console.error('Error merging TOSCA recipes:', error);
    return JSON.parse(JSON.stringify(parsedConstantTemplate)); // Return a copy of the parsed constant template
  }
}

async function createChildsForm(
  app: string,
  index: number,
  deployDialog: HTMLElement,
  buttonsContainer: HTMLElement
) {
  // Create form element
  const form = document.createElement('form');
  form.id = `form-${app.toLowerCase()}`;

  // Load YAML file asynchronously
  const contentsManager = new ContentsManager();
  const file = await contentsManager.get(`templates/${app.toLowerCase()}.yaml`);
  const yamlContent = file.content as string;

  // Parse YAML content
  const yamlData: any = jsyaml.load(yamlContent);
  const metadata = yamlData.metadata;
  const templateName = metadata.template_name;
  const inputs = yamlData.topology_template.inputs;
  const nodeTemplates = yamlData.topology_template.node_templates;
  const outputs = yamlData.topology_template.outputs;

  // Create button for the app
  const appButton = document.createElement('button');
  appButton.className = 'formButton';
  appButton.textContent = templateName;

  // Show form for the selected app when clicked
  appButton.addEventListener('click', () => {
    Array.from(deployDialog.querySelectorAll('form')).forEach(form => {
      form.style.display = 'none';
    });
    form.style.display = 'block';
  });

  // Append button to buttons container
  buttonsContainer.appendChild(appButton);

  // Append form to dialog
  deployDialog.appendChild(form);

  // Show the form for the first app by default
  if (index !== 0) {
    form.style.display = 'none';
  }

  // Extract fields from YAML content and create form inputs
  if (inputs) {
    Object.entries(inputs).forEach(([key, input]) => {
      const description = (input as any).description;
      const constraints = (input as any).constraints;
      const inputField = document.createElement(
        constraints && constraints.length > 0 && constraints[0].valid_values
          ? 'select'
          : 'input'
      );
      inputField.id = key;
      inputField.name = key;

      if (
        constraints &&
        constraints.length > 0 &&
        constraints[0].valid_values
      ) {
        const validValues = constraints[0].valid_values;
        validValues.forEach((value: string) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          inputField.appendChild(option);
        });
      }

      const label = document.createElement('label');
      label.htmlFor = key;
      label.textContent = `${description}:`;

      form.appendChild(document.createElement('br'));
      form.appendChild(label);
      form.appendChild(document.createElement('br'));
      form.appendChild(inputField);
    });
  } else {
    form.innerHTML = '<p>No inputs to be filled.</p><br>';
  }

  return {
    form,
    nodeTemplates,
    outputs
  };
}

//*********************//
//*   Bash commands   *//
//*********************//

async function selectImage(obj: IDeployInfo): Promise<string> {
  const pipeAuth = `${obj.infName}-auth-pipe`;

  let cmd = `%%bash
            PWD=$(pwd)
            # Remove pipes if they exist
            rm -f $PWD/${pipeAuth} &> /dev/null
            # Create directory for templates
            mkdir -p $PWD/templates &> /dev/null
            # Create pipes
            mkfifo $PWD/${pipeAuth}
        `;

  // Command to create the IM-cli credentials
  let authContent = `id = im; type = InfrastructureManager; username = ${obj.IMuser}; password = ${obj.IMpass};\n`;
  authContent += `id = ${obj.id}; type = ${obj.deploymentType}; host = ${obj.host};`;

  if (obj.deploymentType === 'OpenNebula') {
    authContent += ` username = ${obj.username}; password = ${obj.password};`;
  } else if (obj.deploymentType === 'OpenStack') {
    authContent += `username = ${obj.username}; password = ${obj.password}; tenant = ${obj.tenant}; auth_version = ${obj.authVersion};
                domain = ${obj.domain}`;
  } else if (obj.deploymentType === 'EGI') {
    authContent += ` vo = ${obj.vo}; token = ${obj.EGIToken}`;
  }

  cmd += `echo -e "${authContent}" > $PWD/${pipeAuth} &
            # Create final command where the output is stored in "imageOut"
            imageOut=$(python3 ${imClientPath} -a $PWD/${pipeAuth} -r https://im.egi.eu/im cloudimages ${obj.id})
            # Remove pipe
            rm -f $PWD/${pipeAuth} &> /dev/null
            # Print IM output on stderr or stdout
            if [ $? -ne 0 ]; then
                >&2 echo -e $imageOut
                exit 1
            else
                echo -e $imageOut
            fi
            `;

  console.log('cmd', cmd);
  return cmd;
}

const getEGIToken = async () => {
  const code = `%%bash
            TOKEN=$(cat /var/run/secrets/egi.eu/access_token)
            echo $TOKEN
        `;
  const kernelManager = new KernelManager();
  const kernel = await kernelManager.startNew();
  const future = kernel.requestExecute({ code });

  return new Promise((resolve, reject) => {
    future.onIOPub = async msg => {
      const content = msg.content as any;
      const outputText =
        content.text || (content.data && content.data['text/plain']);
      resolve(outputText.trim());
    };
  });
};

async function deployIMCommand(
  obj: IDeployInfo,
  mergedTemplate: string
): Promise<string> {
  const pipeAuth = `${obj.infName}-auth-pipe`;
  const templatePath = '$PWD/deployed-template.yaml';

  let cmd = `%%bash
            PWD=$(pwd)
            # Remove pipes if they exist
            rm -f $PWD/${pipeAuth} &> /dev/null
            # Create directory for templates
            mkdir -p $PWD/templates &> /dev/null
            # Create pipes
            mkfifo $PWD/${pipeAuth}
            # Save mergedTemplate as a YAML file
            echo '${mergedTemplate}' > ${templatePath}
        `;

  // Command to create the IM-cli credentials
  let authContent = `id = im; type = InfrastructureManager; username = ${obj.IMuser}; password = ${obj.IMpass};\n`;
  authContent += `id = ${obj.id}; type = ${obj.deploymentType}; host = ${obj.host}; `;

  if (obj.deploymentType === 'OpenNebula' || obj.deploymentType === 'EC2') {
    authContent += `username = ${obj.username}; password = ${obj.password}`;
  } else if (obj.deploymentType === 'OpenStack') {
    authContent += `username = ${obj.username}; password = ${obj.password}; tenant = ${obj.tenant}; auth_version = ${obj.authVersion};
                domain = ${obj.domain}`;
  } else if (obj.deploymentType === 'EGI') {
    authContent += `vo = ${obj.vo}; token = ${obj.EGIToken}`;
  }

  cmd += `echo -e "${authContent}" > $PWD/${pipeAuth} &
            # Create final command where the output is stored in "imageOut"
            imageOut=$(python3 ${imClientPath} -a $PWD/${pipeAuth} create ${templatePath} -r https://im.egi.eu/im)
            # Remove pipe
            rm -f $PWD/${pipeAuth} &> /dev/null
            # Print IM output on stderr or stdout
            if [ $? -ne 0 ]; then
                >&2 echo -e $imageOut
                exit 1
            else
                echo -e $imageOut
            fi
            `;

  console.log('cmd', cmd);
  return cmd;
}

async function saveToInfrastructureList(obj: IInfrastructureData) {
  const filePath = '$PWD/infrastructuresList.json';
  // Construct the bash command
  const cmd = `
            %%bash
            PWD=$(pwd)
            existingJson=$(cat ${filePath})
            newJson=$(echo "$existingJson" | jq -c '.infrastructures += [${JSON.stringify(obj)}]')
            echo "$newJson" > ${filePath}
        `;

  console.log('Bash command:', cmd);
  return cmd;
}

//****************//
//*  Deployment  *//
//****************//

generateIMCredentials().then(() => {
  console.log(
    'Generated random IM credentials:',
    deployInfo.IMuser,
    deployInfo.IMpass
  );
});

getIMClientPath()
  .then(path => {
    process.env.IM_CLIENT_PATH = path;
    imClientPath = path;
    console.log('IM Client Path:', imClientPath);
  })
  .catch(error => {
    console.error('Error getting IM Client Path:', error);
  });

getInfrastructuresListPath()
  .then(path => {
    process.env.INFRASTRUCTURES_LIST_PATH = infrastructuresListPath;
    infrastructuresListPath = path;
    console.log('Infrastructures List Path:', infrastructuresListPath);
  });

  getDeployedTemplatePath()
  .then(path => {
    process.env.DEPLOYED_TEMPLATE_PATH = deployedTemplatesPath;
    deployedTemplatesPath = path;
    console.log('Deployed Template Path:', deployedTemplatesPath);
  });

const deployChooseProvider = (dialogBody: HTMLElement): void => {
  // Clear dialog body
  dialogBody.innerHTML = '';

  // Create paragraph element for instructions
  const paragraph = document.createElement('p');
  paragraph.textContent = 'Select infrastructure provider:';
  dialogBody.appendChild(paragraph);

  // Create buttons for each provider
  const providers = ['OpenNebula', 'EC2', 'OpenStack', 'EGI'];
  providers.forEach(provider => {
    const button = document.createElement('button');
    button.textContent = provider;
    button.addEventListener('click', () => {
      // Set deployInfo based on the selected provider
      switch (provider) {
        case 'EC2':
          deployInfo.id = 'ec2';
          deployInfo.deploymentType = 'EC2';
          break;
        case 'OpenNebula':
          deployInfo.id = 'one';
          deployInfo.deploymentType = 'OpenNebula';
          break;
        case 'OpenStack':
          deployInfo.id = 'ost';
          deployInfo.deploymentType = 'OpenStack';
          break;
        case 'EGI':
          deployInfo.id = 'egi';
          deployInfo.deploymentType = 'EGI';
          break;
        default:
          console.error('Unsupported provider:', provider);
          return;
      }

      deployRecipeType(dialogBody);
      console.log(`Provider ${provider} selected`);
      console.log('deployInfo:', deployInfo);
    });
    dialogBody.appendChild(button);
  });
};

const deployRecipeType = (dialogBody: HTMLElement): void => {
  // Clear dialog body
  dialogBody.innerHTML = '';

  // Create paragraph element for instructions
  const paragraph = document.createElement('p');
  paragraph.textContent = 'Select recipe type:';
  dialogBody.appendChild(paragraph);

  // Define recipes and their corresponding child elements
  const recipes = [
    {
      name: 'Simple-node-disk',
      childs: ['galaxy', 'ansible_tasks', 'noderedvm', 'minio_compose']
    },
    {
      name: 'Slurm',
      childs: [
        'slurm_cluster',
        'slurm_elastic',
        'slurm_galaxy',
        'docker_cluster'
      ]
    },
    {
      name: 'Kubernetes',
      childs: [
        'kubernetes',
        'kubeapps',
        'prometheus',
        'minio_compose',
        'noderedvm',
        'influxdb',
        'argo'
      ]
    }
  ];

  // Create buttons for each recipe type
  recipes.forEach(recipe => {
    const button = createButton(recipe.name, () => {
      clearDialogElements(dialogBody);
      deployInfo.recipe = recipe.name;
      createCheckboxesForChilds(dialogBody, recipe.childs);
    });
    button.classList.add('recipe-button');
    dialogBody.appendChild(button);
  });

  // Create a back button
  const backBtn = createButton('Back', () => deployChooseProvider(dialogBody));
  backBtn.classList.add('back-button');
  dialogBody.appendChild(backBtn);
};

const createCheckboxesForChilds = async (
  dialogBody: HTMLElement,
  childs: string[]
): Promise<void> => {
  // Create paragraph element for checkboxes
  const paragraph = document.createElement('p');
  paragraph.textContent = 'Select optional recipe features:';
  dialogBody.appendChild(paragraph);

  // Create checkbox grid
  const ul = document.createElement('ul');
  ul.classList.add('checkbox-grid');

  // Load YAML files and create checkboxes
  const contentsManager = new ContentsManager();
  const promises = childs.map(async child => {
    // Load YAML file asynchronously
    const file = await contentsManager.get(
      `templates/${child.toLowerCase()}.yaml`
    );
    const yamlContent = file.content as string;

    // Parse YAML content
    const parsedYaml: any = jsyaml.load(yamlContent);
    const templateName = parsedYaml.metadata.template_name;

    // Create list item for checkbox
    const li = document.createElement('li');

    // Create checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `${child}-checkID`;
    checkbox.name = child;
    checkbox.value = templateName;

    // Create label for checkbox
    const label = document.createElement('label');
    label.htmlFor = child;
    label.textContent = ` ${templateName}`;

    // Check if recipe is Slurm or Kubernetes
    if (
      (deployInfo.recipe === 'Slurm' && child === 'slurm_cluster') ||
      (deployInfo.recipe === 'Kubernetes' && child === 'kubernetes')
    ) {
      checkbox.checked = true; // Check the checkbox
      checkbox.disabled = true; // Disable the checkbox
    }

    // Append checkbox and label to list item
    li.appendChild(checkbox);
    li.appendChild(label);

    // Append list item to checkbox grid
    ul.appendChild(li);
  });

  await Promise.all(promises);

  // Append checkbox grid to dialog body
  dialogBody.appendChild(ul);

  // Create "Next" button
  const nextButton = createButton('Next', () => {
    // Populate deployInfo.childs
    const selectedChilds = Array.from(
      dialogBody.querySelectorAll('input[type="checkbox"]:checked')
    ).map((checkbox: Element) => (checkbox as HTMLInputElement).name);
    deployInfo.childs = selectedChilds;
    deployProviderCredentials(dialogBody);
  });

  dialogBody.appendChild(nextButton);
};

const deployProviderCredentials = async (
  dialogBody: HTMLElement
): Promise<void> => {
  dialogBody.innerHTML = '';
  const form = document.createElement('form');
  dialogBody.appendChild(form);

  let text = '';

  switch (deployInfo.deploymentType) {
    case 'EC2': {
      const region = 'us-east-1';
      const ami = 'ami-0044130ca185d0880';

      text = '<p>Introduce AWS IAM credentials.</p><br>';
      addFormInput(form, 'Access Key ID:', 'accessKeyId', deployInfo.username);
      addFormInput(
        form,
        'Secret Access Key:',
        'secretAccessKey',
        deployInfo.password,
        'password'
      );
      addFormInput(form, 'Region:', 'region', region);
      addFormInput(form, 'AMI:', 'amiIn', ami);
      break;
    }

    case 'OpenNebula':
    case 'OpenStack':
      text = `<p>Introduce ${deployInfo.deploymentType === 'OpenNebula' ? 'ONE' : 'OST'} credentials.</p><br>`;
      addFormInput(form, 'Username:', 'username', deployInfo.username);
      addFormInput(
        form,
        'Password:',
        'password',
        deployInfo.password,
        'password'
      );
      addFormInput(form, 'Host and port:', 'host', deployInfo.host);
      if (deployInfo.deploymentType === 'OpenStack') {
        addFormInput(form, 'Tenant:', 'tenant', deployInfo.tenant);
        addFormInput(form, 'Domain:', 'domain', deployInfo.domain);
        addFormInput(
          form,
          'Auth version:',
          'authVersion',
          deployInfo.authVersion
        );
      }
      break;

    case 'EGI':
      text = '<p>Introduce EGI credentials.</p><br>';
      addFormInput(form, 'VO:', 'vo', deployInfo.vo);
      addFormInput(form, 'Site name:', 'site', deployInfo.host);
      break;
  }

  form.insertAdjacentHTML('afterbegin', text);

  const backBtn = createButton('Back', () => deployRecipeType(dialogBody));
  const nextButton = createButton('Next', async () => {
    switch (deployInfo.deploymentType) {
      case 'EC2': {
        const region = getInputValue('region');
        const AMI = getInputValue('amiIn');
        const imageURL = 'aws://' + region + '/' + AMI;
        deployInfo.worker.image = imageURL;
        deployInfo.username = getInputValue('accessKeyId');
        deployInfo.password = getInputValue('secretAccessKey');
        break;
      }

      case 'OpenNebula':
      case 'OpenStack':
        deployInfo.username = getInputValue('username');
        deployInfo.password = getInputValue('password');
        deployInfo.host = getInputValue('host');
        if (deployInfo.deploymentType === 'OpenStack') {
          deployInfo.tenant = getInputValue('tenant');
          deployInfo.domain = getInputValue('domain');
          deployInfo.authVersion = getInputValue('authVersion');
        }
        break;

      case 'EGI':
        deployInfo.host = getInputValue('site');
        deployInfo.vo = getInputValue('vo');
        deployInfo.EGIToken = await getEGIToken();
        console.log('EGI Token:', deployInfo.EGIToken);
        break;
    }

    deployInfraConfiguration(dialogBody);
  });
  dialogBody.appendChild(backBtn);
  dialogBody.appendChild(nextButton);
};

async function deployInfraConfiguration(
  dialogBody: HTMLElement
): Promise<void> {
  dialogBody.innerHTML = '';
  const form = document.createElement('form');
  dialogBody.appendChild(form);

  const introParagraph = document.createElement('p');
  introParagraph.textContent = 'Introduce worker VM specifications.';
  form.appendChild(introParagraph);

  addFormInput(
    form,
    'Infrastructure name:',
    'infrastructureName',
    deployInfo.infName
  );
  addFormInput(
    form,
    'Number of VMs:',
    'infrastructureWorkers',
    '1',
    'number',
    '1'
  );
  addFormInput(
    form,
    'Number of CPUs for each VM:',
    'infrastructureCPUs',
    '1',
    'number',
    '1'
  );
  addFormInput(form, 'Memory for each VM:', 'infrastructureMem', '2 GB');
  addFormInput(
    form,
    'Size of the root disk of the VM(s):',
    'infrastructureDiskSize',
    '20 GB'
  );
  addFormInput(
    form,
    'Number of GPUs for each VM:',
    'infrastructureGPUs',
    '1',
    'number',
    '1'
  );

  if (deployInfo.deploymentType !== 'EC2') {
    // Create select image command
    const cmdImageNames = await selectImage(deployInfo);

    try {
      // Execute the deployment command
      await executeKernelCommand(cmdImageNames, async outputText => {
        await createImagesDropdown(outputText, dialogBody);
      });
    } catch (error) {
      console.error('Error executing deployment command:', error);
      alert('No OS images found. Bad credentials.');
    }
  }

  const backBtn = createButton('Back', () =>
    deployProviderCredentials(dialogBody)
  );
  const nextBtn = createButton(
    deployInfo.childs.length === 0 ? 'Deploy' : 'Next',
    () => {
      const selectedImageUri = (
        document.getElementById('imageDropdown') as HTMLSelectElement
      ).value;

      deployInfo.infName = getInputValue('infrastructureName');
      deployInfo.worker.num_instances = parseInt(
        getInputValue('infrastructureWorkers')
      );
      deployInfo.worker.num_cpus = parseInt(
        getInputValue('infrastructureCPUs')
      );
      deployInfo.worker.mem_size = getInputValue('infrastructureMem');
      deployInfo.worker.disk_size = getInputValue('infrastructureDiskSize');
      deployInfo.worker.num_gpus = parseInt(
        getInputValue('infrastructureGPUs')
      );
      deployInfo.worker.image = selectedImageUri;

      if (deployInfo.childs.length === 0) {
        deployFinalRecipe(dialogBody);
      } else {
        deployChildsConfiguration(dialogBody);
      }
    }
  );

  dialogBody.appendChild(backBtn);
  dialogBody.appendChild(nextBtn);
}

const deployChildsConfiguration = async (
  dialogBody: HTMLElement
): Promise<void> => {
  // Clear dialog
  dialogBody.innerHTML = '';

  const childs = deployInfo.childs;

  // Container for buttons
  const buttonsContainer = document.createElement('div');
  buttonsContainer.id = 'buttons-container';
  dialogBody.appendChild(buttonsContainer);

  const forms = await Promise.all(
    childs.map((app, index) =>
      createChildsForm(app, index, dialogBody, buttonsContainer)
    )
  );

  const nodeTemplates = forms.map(form => form.nodeTemplates);
  const outputs = forms.map(form => form.outputs);

  const backBtn = createButton('Back', () =>
    deployInfraConfiguration(dialogBody)
  );
  const nextButton = createButton('Deploy', async () => {
    const contentsManager = new ContentsManager();
    const userInputs = (
      await Promise.all(
        forms.map(async formData => {
          const form = formData.form;
          const childName = form.id.replace('form-', '');

          // Fetch YAML content
          const file = await contentsManager.get(`templates/${childName}.yaml`);
          const yamlContent = file.content as string;
          const yamlData: any = jsyaml.load(yamlContent);
          const recipeInputs = yamlData.topology_template.inputs;

          // Check if recipeInputs is not null or undefined
          if (recipeInputs) {
            // Create an object to hold input structure and values
            const inputsWithValues: {
              [key: string]: {
                description: string;
                default: any;
                value: any;
              };
            } = {};
            Object.entries(recipeInputs).forEach(([inputName, input]) => {
              const defaultValue = (input as any).default || '';
              const inputElement = form.querySelector<HTMLInputElement>(
                `[name="${inputName}"]`
              );
              const userInput = inputElement ? inputElement.value : ''; // Handle null case
              inputsWithValues[inputName] = {
                description: (input as any).description,
                default: defaultValue,
                value: userInput
              };
            });

            // Return the outputs to create final recipe to deploy
            return {
              name: childName,
              inputs: inputsWithValues,
              nodeTemplates: formData.nodeTemplates,
              outputs: formData.outputs
            };
          } else {
            // Handle case where recipeInputs is null or undefined
            console.error(
              `Error: recipeInputs is null or undefined for ${childName}.yaml`
            );
            return null; // or handle the error in another appropriate way
          }
        })
      )
    ).filter((input): input is UserInput => input !== null); // Filter out null values

    deployFinalRecipe(dialogBody, userInputs, nodeTemplates, outputs);
  });

  // Set dialog buttons
  dialogBody.appendChild(backBtn);
  dialogBody.appendChild(nextButton);
};

async function deployFinalRecipe(
  dialogBody: HTMLElement,
  populatedTemplates: UserInput[] = [],
  nodeTemplates: any[] = [],
  outputs: any[] = []
): Promise<void> {
  // Clear the dialog body
  dialogBody.innerHTML = '';

  // Ensure only one deployment occurs at a time
  if (deploying) {
    alert('Previous deploy has not finished.');
    return;
  }
  deploying = true;

  try {
    const contentsManager = new ContentsManager();
    const file = await contentsManager.get('templates/simple-node-disk.yaml');
    const yamlContent = file.content;
    const parsedTemplate = jsyaml.load(yamlContent) as any;

    // Add infrastructure name and a hash to the metadata
    const hash = await computeHash(JSON.stringify(deployInfo));
    parsedTemplate.metadata = parsedTemplate.metadata || {};
    parsedTemplate.metadata.infra_name = `jupyter_${hash}`;

    // Populate the template with worker values
    const workerInputs = parsedTemplate.topology_template.inputs;
    Object.keys(deployInfo.worker).forEach(key => {
      workerInputs[key] = workerInputs[key] || {
        type: typeof deployInfo.worker[key]
      };
      workerInputs[key].default = deployInfo.worker[key];
    });

    // Merge templates
    const mergedTemplate = await mergeTOSCARecipes(
      parsedTemplate,
      populatedTemplates,
      nodeTemplates,
      outputs
    );
    const mergedYamlContent = jsyaml.dump(mergedTemplate);

    // Create deploy command
    const cmdDeploy = await deployIMCommand(deployInfo, mergedYamlContent);

    // Show loading spinner
    dialogBody.innerHTML =
      '<div class="loader-container"><div class="loader"></div></div>';

    await executeKernelCommand(cmdDeploy, outputText =>
      handleFinalDeployOutput(outputText, dialogBody)
    );
  } catch (error) {
    console.error('Error during deployment:', error);
    deploying = false;
  }
}

const handleFinalDeployOutput = async (
  output: string | undefined,
  dialogBody: HTMLElement
): Promise<void> => {
  if (!output) {
    return;
  }

  if (output.toLowerCase().includes('error')) {
    alert(output);
    deploying = false;
    deployInfo.childs.length === 0
      ? deployInfraConfiguration(dialogBody)
      : deployChildsConfiguration(dialogBody);
  } else {
    alert(output);

    // Extract infrastructure ID
    const idMatch = output.match(/ID: ([\w-]+)/);
    const infrastructureID = idMatch ? idMatch[1] : '';

    // Create a JSON object for infrastructure data
    const infrastructureData: IInfrastructureData = {
      IMuser: deployInfo.IMuser,
      IMpass: deployInfo.IMpass,
      name: deployInfo.infName,
      infrastructureID,
      id: deployInfo.id,
      type: deployInfo.deploymentType,
      host: deployInfo.host,
      tenant: deployInfo.tenant,
      user: deployInfo.username,
      pass: deployInfo.password,
      authVersion: deployInfo.authVersion,
      domain: deployInfo.domain,
      vo: deployInfo.vo,
      EGIToken: deployInfo.EGIToken
    };

    const cmdSave = await saveToInfrastructureList(infrastructureData);

    // Execute kernel command to save data
    try {
      // Execute kernel command to save data
      await executeKernelCommand(cmdSave, outputText => {
        console.log('Data saved:', outputText);
      });
    } catch (error) {
      console.error('Error executing kernel command:', error);
      deploying = false;
    }
    // Show the success circle
    dialogBody.innerHTML = `
                <div class="success-container">
                <div class="success-circle">
                <i class="fas fa-check"></i>
                </div>
                <p>Infrastructure successfully deployed</p>
                </div>
                `;
    deploying = false;
  }
};

// Exporting the function that initiates the dialog
export { openDeploymentDialog };
