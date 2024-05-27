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
            console.log("futureReadJson", futureReadJson);
            futureReadJson.onIOPub = (msg) => {
                const content = msg.content as any;
                console.log("content", content);
                console.log("content.text", content.text);
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
            throw new Error("Error creating table"); // Throw an error instead of returning null
        }

        // Parse the JSON data
        let infrastructures: Infrastructure[] = [];
        try {
            if (jsonData) {
                infrastructures = JSON.parse(jsonData).infrastructures;
            }
        } catch (error) {
            console.error("Error parsing JSON data from infrastructuresList.json:", error);
            throw new Error("Error parsing JSON data"); // Throw an error instead of returning null
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
                // Execute kernel to get IP
                const cmdIP = infrastructureIP(infrastructure.infrastructureID);
                const futureIP = kernel.requestExecute({ code: cmdIP });
                const ipResponse = await futureIP.done;
                console.log("ipResponse", ipResponse);
                const ipContent = ipResponse.content as any;
                console.log("ipContent", ipContent);
                console.log("ipContent.text", ipContent.text);
                const ipOutput = ipContent.text || (ipContent.data && ipContent.data['text/plain']);
                ipCell.textContent = ipOutput ? ipOutput.trim() : 'Error';
            } catch (error) {
                console.error(`Error fetching IP for infrastructure ${infrastructure.infrastructureID}:`, error);
                ipCell.textContent = 'Error';
            }

            try {
                // Execute kernel to get State
                const cmdState = infrastructureState(infrastructure);
                const futureState = kernel.requestExecute({ code: cmdState });
                const stateResponse = await futureState.done;
                const stateContent = stateResponse.content as any;
                const stateOutput = stateContent.text || (stateContent.data && stateContent.data['text/plain']);
                stateCell.textContent = stateOutput ? stateOutput.trim() : 'Error';
            } catch (error) {
                console.error(`Error fetching state for infrastructure ${infrastructure.infrastructureID}:`, error);
                stateCell.textContent = 'Error';
            }
        }));

        // Shutdown the kernel after all asynchronous tasks are completed
        await kernel.shutdown();

        return table;
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
            rm -f $PWD/${pipeAuth} &> /dev/null
            # Print IP output on stderr or stdout
            if [ $? -ne 0 ]; then
                >&2 echo -e $ipOut
                exit 1
            else
                echo -e $ipOut
            fi
        `;
        return cmd;
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
        return cmd;
    };

}