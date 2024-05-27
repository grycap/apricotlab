import { KernelManager } from '@jupyterlab/services';
import { Dialog } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';

export module ListDeploymentsLogic {

    interface Infrastructure {
        name: string;
        infrastructureID: string;
        id: string;
        type: string;
        host: string;
        tenant: string;
        user: string;
        pass: string;
        domain?: string;
        auth_version?: string;
    }

    export async function openListDeploymentsDialog(): Promise<void> {
        try {
            const table = await createTable();

            // Create a dialog and append the table to it
            const dialogContent = document.createElement('div');
            dialogContent.appendChild(table);

            const contentWidget = new Widget({ node: dialogContent });
            const dialog = new Dialog({
                title: 'Deployments List',
                body: contentWidget,
                buttons: [Dialog.cancelButton()]
            });

            dialog.launch();
        } catch (error) {
            console.error("Error loading infrastructures list:", error);
        }
    };

    export async function createTable(): Promise<HTMLTableElement> {
        let jsonData: string | null = null;

        // Kernel manager to execute the bash command
        const kernelManager = new KernelManager();
        const kernel = await kernelManager.startNew();

        try {
            // Use a bash command to read the contents of infrastructuresList.json
            const cmdReadJson = "%%bash\n" +
                "cat $PWD/infrastructuresList.json";

            const futureReadJson = kernel.requestExecute({ code: cmdReadJson });

            futureReadJson.onIOPub = (msg) => {
                const content = msg.content as any;
                if (content && content.text) {
                    // Accumulate JSON text from multiple messages if infrastructuresList.json has more than one line
                    jsonData = (jsonData || '') + content.text;
                }
            };

            await futureReadJson.done;

            if (!jsonData) {
                throw new Error("No data received from infrastructuresList.json");
            }
        } catch (error) {
            console.error("Error reading or parsing infrastructuresList.json:", error);
            throw new Error("Error creating table");
        }

        // Parse the JSON data
        let infrastructures: Infrastructure[] = [];
        try {
            if (jsonData) {
                infrastructures = JSON.parse(jsonData).infrastructures;
            }
        } catch (error) {
            console.error("Error parsing JSON data from infrastructuresList.json:", error);
            throw new Error("Error parsing JSON data");
        }

        // Create the table element
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

        // Populate the table rows and fetch IP and state for each infrastructure
        await Promise.all(infrastructures.map(async (infrastructure) => {
            const row = table.insertRow();
            const nameCell = row.insertCell();
            nameCell.textContent = infrastructure.name;
            const idCell = row.insertCell();
            idCell.textContent = infrastructure.infrastructureID;
            const ipCell = row.insertCell();
            const stateCell = row.insertCell();

            try {
                const cmdState = infrastructureState(infrastructure);
                // Execute kernel to get output
                const futureState = kernel.requestExecute({ code: cmdState });
            
                // Initialize stateCell text content as 'Loading...'
                stateCell.textContent = 'Loading...';
            
                futureState.onIOPub = (msg) => {
                    const content = msg.content as any; // Cast content to any type
                    const outputState = content.text || (content.data && content.data['text/plain']);
                    // Ensure outputState is not undefined before updating stateCell text content
                    if (outputState !== undefined) {
                        // Extract the state from the output (if present)
                        const stateWords = outputState.trim().split(" ");
                        const stateIndex = stateWords.indexOf("state:");
                        if (stateIndex !== -1 && stateIndex < stateWords.length - 1) {
                            const state = stateWords[stateIndex + 1].trim();
                            stateCell.textContent = state;
                        } else {
                            stateCell.textContent = 'Error';
                        }
                    }
                };
            
                await futureState.done; // Wait for state request to complete
            } catch (error) {
                console.error(`Error fetching state for infrastructure ${infrastructure.infrastructureID}:`, error);
                stateCell.textContent = 'Error';
            }
            

            try {
                const cmdIP = infrastructureIP(infrastructure.infrastructureID);
                // Execute kernel to get output
                const futureIP = kernel.requestExecute({ code: cmdIP });
            
                // Initialize ipCell text content as 'Loading...'
                ipCell.textContent = 'Loading...';
            
                futureIP.onIOPub = (msg) => {
                    const content = msg.content as any; // Cast content to any type
                    const outputIP = content.text || (content.data && content.data['text/plain']);
                    // Ensure outputIP is not undefined before updating ipCell text content
                    if (outputIP !== undefined) {
                        // Extract the IP from the output (get the last word)
                        const ipWords = outputIP.trim().split(" ");
                        const ip = ipWords[ipWords.length - 1];
                        ipCell.textContent = ip ? ip : 'Error';
                    }
                };
            
                await futureIP.done; // Wait for IP request to complete
            } catch (error) {
                console.error(`Error fetching IP for infrastructure ${infrastructure.infrastructureID}:`, error);
                ipCell.textContent = 'Error';
            }


        }));

        // Shutdown the kernel after all asynchronous tasks are completed
        await kernel.shutdown();

        return table;
    };

    function infrastructureState(infrastructure: Infrastructure): string {
        const infrastructureID = infrastructure.infrastructureID;
        const id = infrastructure.id;
        const deploymentType = infrastructure.type;
        const host = infrastructure.host;
        const user = infrastructure.user;
        const pass = infrastructure.pass;
        const tenant = infrastructure.tenant || '';
        const domain = infrastructure.domain || '';
        const authVersion = infrastructure.auth_version || '';
        const pipeAuth = "auth-pipe";

        let cmd = `%%bash
            PWD=$(pwd)
            # Remove pipes if they exist
            rm -f $PWD/${pipeAuth} &> /dev/null
            # Create pipes
            mkfifo $PWD/${pipeAuth}
            # Command to create the infrastructure manager client credentials
            echo -e "id = im; type = InfrastructureManager; username = user; password = pass;\n`;

        if (deploymentType === "OpenStack" || deploymentType === "OpenNebula" || deploymentType === "AWS") {
            cmd += `id = ${id}; type = ${deploymentType}; host = ${host}; username = ${user}; password = ${pass};`;
            if (deploymentType === "OpenStack") {
                cmd += ` tenant = ${tenant};`;
            }
            if (deploymentType === "OpenStack" || deploymentType === "AWS") {
                cmd += ` domain = ${domain};`;
            }
            if (deploymentType === "OpenStack" && authVersion !== '') {
                cmd += ` auth_version = ${authVersion};`;
            }
            cmd += `\" > $PWD/${pipeAuth} & `
        }

        cmd += `stateOut=$(python3 /usr/local/bin/im_client.py getstate ${infrastructureID} -r https://im.egi.eu/im -a $PWD/${pipeAuth})
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
        console.log('cmdState', cmd);
        return cmd;
    };

    function infrastructureIP(infrastructureID: string): string {
        const pipeAuth = "auth-pipe";
        let cmd = `%%bash
            PWD=$(pwd)
            # Remove pipes if they exist
            rm -f $PWD/${pipeAuth} &> /dev/null
            # Create pipes
            mkfifo $PWD/${pipeAuth}
            # Command to create the infrastructure manager client credentials
            echo -e "id = im; type = InfrastructureManager; username = user; password = pass;" > $PWD/${pipeAuth} &
            # Execute command to get IP
            ipOut=$(python3 /usr/local/bin/im_client.py getvminfo ${infrastructureID} 0 net_interface.1.ip -r https://im.egi.eu/im -a $PWD/${pipeAuth})
            # Remove pipe
            # Print IP output on stderr or stdout
            if [ $? -ne 0 ]; then
                >&2 echo -e $ipOut
                exit 1
            else
                echo -e $ipOut
            fi
        `;
        console.log('cmdIP', cmd);
        return cmd;
    };

}