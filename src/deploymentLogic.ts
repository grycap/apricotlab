import * as jsyaml from 'js-yaml';
import { ContentsManager } from '@jupyterlab/services';
import { KernelManager } from '@jupyterlab/services';

export module DeploymentLogic {

    interface DeployInfo {
        recipe: string;
        id: string;
        deploymentType: string;
        host: string;
        tenant: string;
        username: string;
        password: string;
        port: string;
        infName: string;
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

    interface TemplateInput {
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

    interface InfrastructureData {
        name: string;
        infrastructureID: string;
        id: string;
        type: string;
        host: string;
        tenant: string;
        user: string;
        pass: string;
    }

    let deployInfo: DeployInfo = {
        recipe: '',
        id: '',
        deploymentType: '',
        host: 'ramses.i3m.upv.es:2633',
        tenant: '',
        username: 'asanchez',
        password: 'RamsesOpenNebula9',
        port: '',
        infName: 'infra-name',
        worker: {
            num_instances: 1,
            num_cpus: 1,
            mem_size: '2 GB',
            disk_size: '20 GB',
            num_gpus: 1,
            image: '',
        },
        childs: [],
    };

    let deploying = false; // Flag to prevent multiple deployments at the same time

    //*****************//
    //* Aux functions *//
    //*****************// 

    const createButton = (label: string, onClick: () => void): HTMLButtonElement => {
        const button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', onClick);
        // Set an id for the "Next" button
        if (label === 'Next') {
            button.id = 'nextButton';
        }
        return button;
    };

    const clearCheckboxes = (dialogBody: HTMLElement): void => {
        // Remove all elements except for the three buttons
        const elementsToRemove = dialogBody.querySelectorAll(':not(button)');
        elementsToRemove.forEach((element) => {
            // Check if the element is not one of the three buttons
            if (!element.classList.contains('recipe-button')) {
                element.remove(); // Remove the element
            }
        });
    };

    const addFormInput = (form: HTMLFormElement, labelText: string, inputId: string, value: string = '', type: string = 'text', p0?: string): void => {
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
    };

    async function handleKernelOutput(output: string | undefined, dialogBody: HTMLElement) {
        if (output && output.toLowerCase().includes('error')) {
            alert(output);
            deploying = false;
            if (deployInfo.childs.length === 0) {
                deployInfraConfiguration(dialogBody);
            } else {
                deployChildsConfiguration(dialogBody);
            }
        } else if (output) {
            alert(output);
            // Extract infrastructure ID
            const idMatch = output.match(/ID: ([\w-]+)/);
            const infrastructureID = idMatch ? idMatch[1] : '';
    
            // Create a JSON object
            const jsonObj = {
                name: deployInfo.infName,
                infrastructureID: infrastructureID,
                id: deployInfo.id,
                type: deployInfo.deploymentType,
                host: deployInfo.host,
                tenant: deployInfo.tenant,
                user: deployInfo.username,
                pass: deployInfo.password,
                // domain: deployInfo.domain,
                // authVersion: deployInfo.authVersion,
            };
    
            const cmdSaveToInfrastructureList = await saveToInfrastructureList(jsonObj);
            
            // Execute kernel to get output
            const kernelManager = new KernelManager();
            const kernel = await kernelManager.startNew();
            const future = kernel.requestExecute({ code: cmdSaveToInfrastructureList });
            
            future.onIOPub = (msg) => {
                const content = msg.content as any; // Cast content to any type
                const output = content.text || (content.data && content.data['text/plain']);
    
                // Pass all output to handleKernelOutput function
                handleKernelOutput(output, dialogBody);
            };
            dialogBody.innerHTML = '';
            deploying = false;
        }
    }; 

    function deployIMCommand(obj: DeployInfo, mergedTemplate: string): string {
        const pipeAuth = `${obj.infName}-auth-pipe`;
        const imageRADL = obj.infName;
        const templatePath = `~/.imclient/templates/${imageRADL}.yaml`;

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
        let authContent = `id = im; type = InfrastructureManager; username = user; password = pass;\n`;
        authContent += `id = ${obj.id}; type = ${obj.deploymentType}; host = ${obj.host}; username = ${obj.username}; password = ${obj.password};`;

        if (obj.deploymentType === 'OpenStack') {
            authContent += ` tenant = ${obj.tenant};`;
        } else if (obj.deploymentType === 'AWS') {
            authContent += ` image = ${obj.worker.image};`;
        }

        cmd += `echo -e "${authContent}" > $PWD/${pipeAuth} &
            # Create final command where the output is stored in "imOut"
            imOut=$(python3 /usr/local/bin/im_client.py -a $PWD/${pipeAuth} create ${templatePath} -r https://im.egi.eu/im)
            # Remove pipe
            rm -f $PWD/${pipeAuth} &> /dev/null
            # Print IM output on stderr or stdout
            if [ $? -ne 0 ]; then
                >&2 echo -e $imOut
                exit 1
            else
                echo -e $imOut
            fi
            `;

        console.log("cmd", cmd);
        return cmd;
    };

    async function saveToInfrastructureList(obj: InfrastructureData) {
        const filePath = "$PWD/infrastructuresList.json";

        // Construct the bash command
        const cmd = `
            %%bash
            PWD=$(pwd)
            existingJson=$(cat ${filePath})
            newJson=$(echo "$existingJson" | jq '.infrastructures += [${JSON.stringify(obj)}]')
            echo "$newJson" > ${filePath}
        `;

        console.log("cmd", cmd);
        return cmd;
    };

    async function computeHash(input: string): Promise<string> {
        const msgUint8 = new TextEncoder().encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    };

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
                                    const inputValue = (input as TemplateInput).value;

                                    console.log('Merging input:', inputName, 'with value:', inputValue);

                                    // Merge or add inputs in the constant template
                                    if (mergedTemplate.topology_template.inputs?.hasOwnProperty(inputName)) {
                                        mergedTemplate.topology_template.inputs[inputName].default = inputValue;
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
                            Object.entries(template.nodeTemplates).forEach(([nodeTemplateName, nodeTemplate]) => {
                                mergedTemplate.topology_template.node_templates = {
                                    ...mergedTemplate.topology_template.node_templates,
                                    [nodeTemplateName]: nodeTemplate
                                };
                            });
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
            console.error("Error merging TOSCA recipes:", error);
            return JSON.parse(JSON.stringify(parsedConstantTemplate)); // Return a copy of the parsed constant template
        }
    };

    //****************//
    //*  Deployment  *//
    //****************// 

    export const deployChooseProvider = (dialogBody: HTMLElement): void => {
        // Clear dialog body
        dialogBody.innerHTML = '';

        // Create paragraph element for instructions
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Select infrastructure provider:';
        dialogBody.appendChild(paragraph);

        // Create buttons for each provider
        const providers = ['OpenNebula', 'EC2', 'OpenStack'];
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
            { name: 'Simple-node-disk', childs: ['galaxy', 'ansible_tasks', 'noderedvm', 'minio_compose'] },
            { name: 'Slurm', childs: ['slurm_cluster', 'slurm_elastic', 'slurm_galaxy', 'docker_cluster'] },
            { name: 'Kubernetes', childs: ['kubernetes', 'kubeapps', 'prometheus', 'minio_compose', 'noderedvm', 'influxdb', 'argo'] }
        ];

        // Create buttons for each recipe type
        recipes.forEach(recipe => {
            const button = createButton(recipe.name, () => {
                // Clear existing checkboxes
                clearCheckboxes(dialogBody);
                deployInfo.recipe = recipe.name;
                createCheckboxesForChilds(dialogBody, recipe.childs);
            });

            dialogBody.appendChild(button);
        });

    };

    const createCheckboxesForChilds = async (dialogBody: HTMLElement, childs: string[]): Promise<void> => {
        // Create paragraph element for checkboxes
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Select optional recipe features:';
        dialogBody.appendChild(paragraph);

        // Create checkbox grid
        const ul = document.createElement('ul');
        ul.classList.add('checkbox-grid');

        // Load YAML files and create checkboxes
        await Promise.all(childs.map(async (child) => {
            // Load YAML file asynchronously
            const contentsManager = new ContentsManager();
            const file = await contentsManager.get(`templates/${child.toLowerCase()}.yaml`);
            const yamlContent = file.content as string;

            // Parse YAML content
            const parsedYaml: any = jsyaml.load(yamlContent);
            const metadata = parsedYaml.metadata;
            const templateName = metadata.template_name;

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
            if ((deployInfo.recipe === 'Slurm' && child === 'slurm_cluster') ||
                (deployInfo.recipe === 'Kubernetes' && child === 'kubernetes')) {
                checkbox.checked = true; // Check the checkbox
                checkbox.disabled = true; // Disable the checkbox
            }

            // Append checkbox and label to list item
            li.appendChild(checkbox);
            li.appendChild(label);

            // Append list item to checkbox grid
            ul.appendChild(li);
        }));

        // Append checkbox grid to dialog body
        dialogBody.appendChild(ul);

        // Create "Next" button
        const nextButton = createButton('Next', () => {
            // Populate deployInfo.childs
            const selectedChilds = Array.from(dialogBody.querySelectorAll('input[type="checkbox"]:checked'))
                .map((checkbox: Element) => (checkbox as HTMLInputElement).name);
            deployInfo.childs = selectedChilds;
            deployProviderCredentials(dialogBody);
        });

        dialogBody.appendChild(nextButton);
    };

    const deployProviderCredentials = (dialogBody: HTMLElement): void => {
        dialogBody.innerHTML = '';
        const form = document.createElement('form');
        dialogBody.appendChild(form);

        let text = '';

        switch (deployInfo.deploymentType) {
            case 'EC2':
                const zone = "us-east-1";
                const ami = "ami-0044130ca185d0880";

                text = `<p>Introduce AWS IAM credentials.</p><br>`;
                addFormInput(form, 'Access Key ID:', 'accessKeyId', deployInfo.username);
                addFormInput(form, 'Secret Access Key:', 'secretAccessKey', deployInfo.password, 'password');
                addFormInput(form, 'Availability zone:', 'availabilityZoneIn', zone);
                addFormInput(form, 'AMI:', 'amiIn', ami);

                if (deployInfo.recipe === "Simple-node-disk") {
                    addFormInput(form, 'Port to be opened in AWS:', 'infrastructurePort', '1', 'number');
                }
                break;

            case 'OpenNebula':
            case 'OpenStack':
                text = `<p>Introduce ${deployInfo.deploymentType === 'OpenNebula' ? 'ONE' : 'OST'} credentials.</p><br>`;
                addFormInput(form, 'Username:', 'username', deployInfo.username);
                addFormInput(form, 'Password:', 'password', deployInfo.password, 'password');
                addFormInput(form, 'Host and port:', 'host', deployInfo.host);
                if (deployInfo.deploymentType === 'OpenStack') {
                    addFormInput(form, 'Tenant:', 'tenant', deployInfo.tenant);
                }
                break;
        }

        form.insertAdjacentHTML('afterbegin', text);

        const backBtn = createButton('Back', () => deployRecipeType(dialogBody));
        const nextButton = createButton('Next', () => {
            switch (deployInfo.deploymentType) {
                case 'EC2':
                    const AWSzone = getInputValue('availabilityZoneIn');
                    const AMI = getInputValue('amiIn');
                    const imageURL = "aws://" + AWSzone + "/" + AMI;
                    deployInfo.worker.image = imageURL;
                    //deployInfo.worker.image = `aws://${AWSzone}/${AMI}`;

                    if (deployInfo.recipe === "Simple-node-disk") {
                        deployInfo.port = getInputValue('infrastructurePort');
                    }
                    break;
                case 'OpenNebula':
                case 'OpenStack':
                    deployInfo.username = getInputValue('username');
                    deployInfo.password = getInputValue('password');
                    deployInfo.host = getInputValue('host');
                    if (deployInfo.deploymentType === 'OpenStack') {
                        deployInfo.tenant = getInputValue('tenant');
                    }
                    break;
            }

            deployInfraConfiguration(dialogBody);
        });
        dialogBody.appendChild(backBtn);
        dialogBody.appendChild(nextButton);
    };

    const deployInfraConfiguration = (dialogBody: HTMLElement): void => {
        dialogBody.innerHTML = '';
        const form = document.createElement('form');
        dialogBody.appendChild(form);

        const introParagraph = document.createElement('p');
        introParagraph.textContent = "Introduce worker VM specifications.";
        form.appendChild(introParagraph);

        addFormInput(form, 'Infrastructure name:', 'infrastructureName', deployInfo.infName);
        addFormInput(form, 'Number of VMs:', 'infrastructureWorkers', '1', 'number', '1');
        addFormInput(form, 'Number of CPUs for each VM:', 'infrastructureCPUs', '1', 'number', '1');
        addFormInput(form, 'Memory for each VM:', 'infrastructureMem', '2 GB');
        addFormInput(form, 'Size of the root disk of the VM(s):', 'infrastructureDiskSize', '20 GB');
        addFormInput(form, 'Number of GPUs for each VM:', 'infrastructureGPUs', '1', 'number', '1');

        const backBtn = createButton('Back', () => deployProviderCredentials(dialogBody));
        const nextBtn = createButton(deployInfo.childs.length === 0 ? "Deploy" : "Next", () => {
            deployInfo.infName = getInputValue('infrastructureName');
            deployInfo.worker.num_instances = parseInt(getInputValue('infrastructureWorkers'));
            deployInfo.worker.num_cpus = parseInt(getInputValue('infrastructureCPUs'));
            deployInfo.worker.mem_size = getInputValue('infrastructureMem');
            deployInfo.worker.disk_size = getInputValue('infrastructureDiskSize');
            deployInfo.worker.num_gpus = parseInt(getInputValue('infrastructureGPUs'));

            if (deployInfo.childs.length === 0) {
                console.log('deployInfoA:', deployInfo);
                deployFinalRecipe(dialogBody);
            } else {
                console.log('deployInfoB:', deployInfo);
                deployChildsConfiguration(dialogBody);
            }
        });

        dialogBody.appendChild(backBtn);
        dialogBody.appendChild(nextBtn);
    };

    const deployChildsConfiguration = async (dialogBody: HTMLElement): Promise<void> => {
        // Clear dialog
        dialogBody.innerHTML = '';

        const childs = deployInfo.childs;

        // Container for buttons
        const buttonsContainer = document.createElement('div');
        buttonsContainer.id = 'buttons-container';
        dialogBody.appendChild(buttonsContainer);

        const forms = await Promise.all(childs.map((app, index) => createChildsForm(app, index, dialogBody, buttonsContainer)));

        const nodeTemplates = forms.map(form => form.nodeTemplates);
        const outputs = forms.map(form => form.outputs);

        const backBtn = createButton('Back', () => deployProviderCredentials(dialogBody));
        const nextButton = createButton('Deploy', async () => {
            const contentsManager = new ContentsManager();
            const userInputs = (await Promise.all(forms.map(async formData => {
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
                    const inputsWithValues: { [key: string]: { description: string; default: any; value: any } } = {};
                    Object.entries(recipeInputs).forEach(([inputName, input]) => {
                        const defaultValue = (input as any).default || '';
                        const inputElement = form.querySelector<HTMLInputElement>(`[name="${inputName}"]`);
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
                    console.error(`Error: recipeInputs is null or undefined for ${childName}.yaml`);
                    return null; // or handle the error in another appropriate way
                }
            }))).filter((input): input is UserInput => input !== null); // Filter out null values

            deployFinalRecipe(dialogBody, userInputs, nodeTemplates, outputs);
        });

        // Set dialog buttons
        dialogBody.appendChild(backBtn);
        dialogBody.appendChild(nextButton);
    };

    async function createChildsForm(app: string, index: number, deployDialog: HTMLElement, buttonsContainer: HTMLElement) {
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
                const inputField = document.createElement(constraints && constraints.length > 0 && constraints[0].valid_values ? 'select' : 'input');
                inputField.id = key;
                inputField.name = key;

                if (constraints && constraints.length > 0 && constraints[0].valid_values) {
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
            form.innerHTML = "<p>No inputs to be filled.</p><br>";
        }

        return {
            form,
            nodeTemplates,
            outputs
        };
    };

    async function deployFinalRecipe(
        dialogBody: HTMLElement,
        populatedTemplates: UserInput[] = [],
        nodeTemplates: any[] = [],
        outputs: any[] = []
    ): Promise<void> {
        // Clear dialog
        dialogBody.innerHTML = '';
    
        // Deploy only one infrastructure at once
        if (deploying) {
            alert('Previous deploy has not finished.');
            return;
        }
        deploying = true;
    
        try {
            // Load constant template
            const contentsManager = new ContentsManager();
            const file = await contentsManager.get('templates/simple-node-disk.yaml');
            const yamlContentFromFile = file.content;
            const parsedConstantTemplate = jsyaml.load(yamlContentFromFile) as any;
    
            // Add infra_name field and a hash to metadata field
            const hash = await computeHash(JSON.stringify(deployInfo));
            parsedConstantTemplate.metadata = parsedConstantTemplate.metadata || {};
            parsedConstantTemplate.metadata.infra_name = `jupyter_${hash}`;
    
            // Populate constant template with worker values
            const workerInputs = parsedConstantTemplate.topology_template.inputs;
            Object.keys(deployInfo.worker).forEach(key => {
                if (workerInputs.hasOwnProperty(key)) {
                    // Update the default value of the existing input
                    workerInputs[key].default = deployInfo.worker[key];
                } else {
                    // If the input doesn't exist, add it dynamically
                    workerInputs[key] = {
                        type: typeof deployInfo.worker[key],
                        default: deployInfo.worker[key]
                    };
                }
            });
    
            // Merge constant template with populated templates
            const mergedTemplate = await mergeTOSCARecipes(parsedConstantTemplate, populatedTemplates, nodeTemplates, outputs);
            const yamlContent = jsyaml.dump(mergedTemplate);
    
            // Create deploy script
            const cmdDeployIMCommand = deployIMCommand(deployInfo, yamlContent);
    
            // Show loading spinner
            dialogBody.innerHTML = '<div class="loader"></div>';
    
            // Execute kernel to get output
            const kernelManager = new KernelManager();
            const kernel = await kernelManager.startNew();
            const future = kernel.requestExecute({ code: cmdDeployIMCommand });
    
            future.onIOPub = (msg) => {
                const content = msg.content as any; // Cast content to any type
                const output = content.text || (content.data && content.data['text/plain']);
    
                // Pass all output to handleKernelOutput function
                handleKernelOutput(output, dialogBody);
            };
    
        } catch (error) {
            console.error('Error deploying infrastructure:', error);
            deploying = false;
        }
    };

}
