from tabulate import tabulate
from IPython.core.magic import Magics, line_magic, line_cell_magic, magics_class
from subprocess import run, PIPE, CalledProcessError
from pathlib import Path
from imclient import IMClient

import requests
import jwt
import time
import os
import json
import sys

IM_ENDPOINT = "https://im.egi.eu/im"


@magics_class
class Apricot_Magics(Magics):

    def __init__(self, shell):
        super().__init__(shell)
        self.load_paths()

        data = self.load_json(self.inf_list_path)
        access_token = data.get("access_token")

        if access_token != "":
            auth = f"""
                type = InfrastructureManager; token = {access_token}
            """
        else:
            refresh_token = data["refresh_token"]
            self.generate_new_access_token(refresh_token)

        self.client = IMClient.init_client(IM_ENDPOINT, auth)

    ########################
    #  Auxiliar functions  #
    ########################

    def load_paths(self):
        # Get the absolute path to the current file (apricot_magics.py)
        current_dir = Path(__file__).parent

        # Construct the path to the 'resources' folder relative to 'apricot_magics/'
        resources_dir = current_dir.parent / "resources"

        self.inf_list_path = resources_dir / "infrastructuresList.json"
        self.deployed_template_path = resources_dir / "deployed-template.yaml"
        self.authfile_path = resources_dir / "authfile"

        # Check if the files exist
        if not self.inf_list_path.exists():
            raise FileNotFoundError(f"File not found: {self.inf_list_path}")
        if not self.deployed_template_path.exists():
            raise FileNotFoundError(f"File not found: {self.deployed_template_path}")

    def load_json(self, path):
        """Load a JSON file and handle errors."""
        try:
            with open(path) as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            raise ValueError(f"Error loading JSON from {path}: {e}")

    def initialize_im_client(self):
        """Ensure access token is valid in auth-file, then initialize IMClient."""
        self.check_token()
        auth_content = IMClient.read_auth_data(self.authfile_path)
        self.client = IMClient.init_client(IM_ENDPOINT, auth_content)

    def cleanup_files(self, *files):
        for file in files:
            if os.path.exists(file):
                os.remove(file)

    def execute_command(self, cmd):
        """Execute a command and return stdout, or handle the output differently."""
        try:
            result = run(cmd, stdout=PIPE, stderr=PIPE, check=True, text=True)

            if result.returncode == 0:
                return result.stdout

        except CalledProcessError as e:
            print(f"Error: {e.stderr}")

    def generate_key(self, inf_id, vm_id):
        """Generates private key and host IP from infrastructure and VM info."""
        try:
            self.initialize_im_client()
            success, inf_key = self.client.getinfo(
                inf_id, "disk.0.os.credentials.private_key"
            )

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        private_key_content = list(inf_key)[0][2]

        if private_key_content:
            with open("key.pem", "w") as key_file:
                key_file.write(private_key_content)
            os.chmod("key.pem", 0o600)

        return private_key_content

    def resolve_ssh_user(self, inf_id):
        try:
            self.initialize_im_client()
            success, inf_info = self.client.getinfo(
                inf_id, "disk.0.os.credentials.username"
            )

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        ssh_username = list(inf_info)[0][2]

        return ssh_username

    def apricot_transfer(self, inf_id, vm_id, files, destination, transfer_type):
        """Handle SCP upload and download."""
        try:
            self.authfile_path
        except ValueError as e:
            print(e)
            return "Failed"

        # Generate private key content and host IP
        private_key_content = self.generate_key(inf_id, vm_id)
        if not private_key_content:
            print("Error: Unable to generate private key.")
            return "Failed"

        ssh_user = self.resolve_ssh_user(inf_id)
        if not ssh_user:
            print(f"Error: Unable to resolve SSH user for infrastructure {inf_id}.")
            return "Failed"

        host_ip = self.get_vm_ip(inf_id)
        if not host_ip:
            print(f"Error: Unable to resolve IP user for infrastructure {inf_id}.")
            return "Failed"

        # Construct the SCP command
        cmd_scp = [
            "scp",
            "-i",
            "key.pem",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "UserKnownHostsFile=/dev/null",
        ]

        # Add file paths based on the transfer type
        if transfer_type == "upload":
            # Add local files and remote destination
            cmd_scp.extend(files)
            cmd_scp.append(f"{ssh_user}@{host_ip}:{destination}")
        else:
            # Add remote files and local destination
            for file in files:
                cmd_scp.append(f"{ssh_user}@{host_ip}:{file}")
            cmd_scp.append(destination)

        # Execute the SCP command using execute_command
        output = self.execute_command(cmd_scp)
        print(output)

        self.cleanup_files("key.pem")

        return "Done"

    def remove_infrastructure_from_list(self, inf_id):
        # Load infrastructure list from JSON file
        try:
            data = self.load_json(self.inf_list_path)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"Error loading infrastructure list: {e}")
            return "Failed"

        # Find and remove the infrastructure with the specified ID
        for infrastructure in data["infrastructures"]:
            if infrastructure["infrastructureID"] == inf_id:
                data["infrastructures"].remove(infrastructure)
                break

        # Write the updated infrastructure list back to the JSON file
        try:
            with open(self.inf_list_path, "w") as f:
                json.dump(data, f, indent=4)
        except IOError as e:
            print(f"Error writing to file {self.inf_list_path}: {e}")
            return "Failed"

    def get_infrastructure_state(self, inf_id):
        try:
            self.initialize_im_client()
            success, inf_info = self.client.get_infra_property(inf_id, "state")
            state = inf_info.get("state", "Error getting status info")

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        return state

    def get_vm_ip(self, inf_id):
        try:
            self.initialize_im_client()
            success, inf_info = self.client.get_infra_property(inf_id, "outputs")
            ip = inf_info.get("node_ip")

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        return ip

    ########################
    #    Manage tokens     #
    ########################

    def generate_new_access_token(self, refresh_token):
        """Generate a new access token using a refresh token."""
        refresh_url = "https://aai.egi.eu/auth/realms/egi/protocol/openid-connect/token"
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": "token-portal",
            "scope": "openid email profile voperson_id eduperson_entitlement",
        }

        response = requests.post(refresh_url, data=payload)

        if response.status_code == 200:
            new_access_token = response.json()["access_token"]
            if not new_access_token:
                print("Failed to generate a new access token.")
                return None

            print("New access token generated successfully.")

            self.save_new_access_token(new_access_token)
            return new_access_token

        else:
            print("Error generating access token:")
            print(response.text)
            return None

    def save_new_access_token(self, new_access_token):
        """Save the new access token to the auth-file."""
        with open(self.authfile_path, "r") as f:
            lines = f.readlines()

        updated_lines = []
        for line in lines:
            if "token =" in line:
                parts = [part.strip() for part in line.split(";")]
                updated_parts = []
                for part in parts:
                    if part.startswith("token ="):
                        updated_parts.append(f"token = {new_access_token}")
                    else:
                        updated_parts.append(part)
                updated_line = "; ".join(updated_parts)
                updated_lines.append(updated_line + "\n")
            else:
                updated_lines.append(line)

        with open(self.authfile_path, "w") as f:
            f.writelines(updated_lines)

        return new_access_token

    def check_token(self):
        """Check if the access token in the authfile is valid. Refresh if expired."""
        access_token = None

        try:
            with open(self.authfile_path, "r") as f:
                for line in f:
                    if "token =" in line:
                        parts = [part.strip() for part in line.split(";")]
                        for part in parts:
                            if part.startswith("token ="):
                                access_token = part.split("=", 1)[1].strip()
                                break
                    if access_token:
                        break
        except FileNotFoundError:
            print(f"Auth file not found: {self.authfile_path}")
            return None

        if not access_token:
            print("No access token provided.")
            return False

        try:
            decoded_token = jwt.decode(
                access_token,
                options={"verify_signature": False},
                algorithms=["HS256", "RS256"],
            )
            expiry_time = decoded_token.get("exp", 0)
            current_time = int(time.time())

            if expiry_time > current_time:
                return None  # Token is still valid
            else:
                print("Token has expired.")
                data = self.load_json(self.inf_list_path)
                refresh_token = data.get("refresh_token")

                if not refresh_token:
                    print(
                        "No refresh token available. Run `%apricot_token <refresh_token>` first."
                    )
                    return None

                return self.generate_new_access_token(refresh_token)

        except jwt.DecodeError:
            print("Invalid token format.")
            return None

    ##################
    #     Magics     #
    ##################

    @line_magic
    def apricot_token(self, line):
        data = self.load_json(self.inf_list_path)

        if not line:
            refresh_token = data.get("refresh_token", "").strip()

            if not refresh_token:
                print(
                    "No refresh token found. Please provide one by running `%apricot_token <refresh_token>`"
                )
                return
            else:
                self.generate_new_access_token(refresh_token)
                return

        # If a new token is provided via command line
        refresh_token = line.strip()
        data["refresh_token"] = refresh_token

        with open(self.inf_list_path, "w") as f:
            json.dump(data, f, indent=4)

        self.generate_new_access_token(refresh_token)

    @line_magic
    def apricot_log(self, line):
        if not line:
            return "Usage: `%apricot_log <infrastructure-id>`\n"

        inf_id = line.split()[0]

        try:
            self.initialize_im_client()
            success, inf_info = self.client.get_infra_property(inf_id, "contmsg")

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        print(inf_info)

    @line_magic
    def apricot_ls(self, line):
        infrastructures_list = []

        data = self.load_json(self.inf_list_path)

        for infrastructure in data.get("infrastructures", []):
            infrastructure_info = {
                "Name": infrastructure.get("name", ""),
                "InfrastructureID": infrastructure.get("infrastructureID", ""),
                "IP": "",
                "State": "",
            }

            try:
                self.authfile_path
                infrastructure_info["State"] = self.get_infrastructure_state(
                    infrastructure_info["InfrastructureID"]
                )
                infrastructure_info["IP"] = self.get_vm_ip(
                    infrastructure_info["InfrastructureID"]
                )

            except Exception as e:
                print(f"Error: {e}")
                return "Failed"

            infrastructures_list.append(infrastructure_info)

        infrastructure_data = [
            [infra["Name"], infra["InfrastructureID"], infra["IP"], infra["State"]]
            for infra in infrastructures_list
        ]

        print(
            tabulate(
                infrastructure_data,
                headers=[
                    "Infrastructure name",
                    "Infrastructure ID",
                    "IP Address",
                    "Status",
                ],
                tablefmt="grid",
            )
        )

    @line_magic
    def apricot_info(self, line):
        if not line:
            return "Usage: `%apricot_info infrastructure-id`\n"

        inf_id = line.split()[0]

        try:
            self.initialize_im_client()
            success, inf_info = self.client.getinfo(inf_id)

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        for item in inf_info:
            print(*item, sep="\n")

        # @line_magic
        # def apricot_vmls(self, line):
        if not line:
            print("Usage: `%apricot_vmls infrastructure-id`\n")
            return "Fail"

        inf_id = line.split()[0]
        vm_info_list = []

        try:
            self.initialize_im_client()
            success, inf_info = self.client.getinfo(inf_id)

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        for item in inf_info:
            vm_id = item[0]
            (
                net_interface_ip,
                provider_type,
                disk_size,
                cpu_count,
                memory_size,
                gpu_count,
            ) = (None, None, None, None, None, None)

            output_string = item[
                2
            ]  # The third element contains the VM details as a string
            for line in output_string.split("\n"):
                if "net_interface.0.ip =" in line:
                    net_interface_ip = (
                        line.split("= ")[1].strip().replace("'", "").split(" ")[0]
                    )
                if "provider.type =" in line:
                    provider_type = (
                        line.split("= ")[1].strip().replace("'", "").split(" ")[0]
                    )
                if "disk.0.size >=" in line:
                    disk_size = line.split(">= ")[1].strip().strip("'").split(" ")[0]
                if "cpu.count =" in line:
                    cpu_count = line.split("= ")[1].strip().strip("'").split(" ")[0]
                if "memory.size =" in line:
                    memory_size = line.split("= ")[1].strip().strip("'").split(" ")[0]
                if "gpu.count >=" in line:
                    gpu_count = line.split(">= ")[1].strip().strip("'").split(" ")[0]

            start_time = time.time()
            while not all(
                (
                    vm_id,
                    net_interface_ip,
                    provider_type,
                    disk_size,
                    cpu_count,
                    memory_size,
                    memory_size,
                )
            ):  # Ensure valid values
                if time.time() - start_time > 4:
                    break
                # time.sleep(1)

                # if all((vm_id, net_interface_ip, provider_type, disk_size, cpu_count, memory_size, gpu_count)):
                vm_info_list.append(
                    [
                        vm_id,
                        net_interface_ip,
                        provider_type,
                        disk_size,
                        cpu_count,
                        memory_size,
                        gpu_count,
                    ]
                )

        # Print table
        print(
            tabulate(
                vm_info_list,
                headers=[
                    "VM ID",
                    "IP Address",
                    "Provider",
                    "Disk Size",
                    "CPU Count",
                    "Memory Size",
                    "GPU Count",
                ],
                tablefmt="grid",
            )
        )

        return

    @line_cell_magic
    def apricot_create(self, line):
        if not line:
            print("Usage: `%apricot_create <recipe>`\n")
            return "Fail"

        inf_desc = line

        try:
            if inf_desc.startswith("[") or inf_desc.startswith("{"):
                desc_type = "json"
            elif "tosca_definitions_version" in inf_desc:
                desc_type = "yaml"
            else:
                desc_type = "radl"

            self.initialize_im_client()
            success, inf_info = self.client.create(inf_desc, desc_type)

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        if "error" in inf_info.lower():
            print(inf_info)
        else:
            print("Infrastructure with ID " + inf_info + " successfully created.")

            data = self.load_json(self.inf_list_path)

            new_infra = {"infrastructureID": inf_info}
            data["infrastructures"].append(new_infra)

            with open(self.inf_list_path, "w") as f:
                json.dump(data, f, indent=4)

    @line_magic
    def apricot_upload(self, line):
        if len(line) == 0 or len(line.split()) < 3:
            print(
                "Usage: `%apricot_upload <infrastructure-id> <file1> <file2> ... <fileN> <remote-destination-path>`\n"
            )
            return "Fail"

        words = line.split()
        inf_id = words[0]
        vm_id = "0"  # words[1]
        destination = words[-1]
        files = words[1:-1]

        return self.apricot_transfer(
            inf_id, vm_id, files, destination, transfer_type="upload"
        )

    @line_magic
    def apricot_download(self, line):
        if len(line) == 0 or len(line.split()) < 3:
            print(
                "Usage: `%apricot_download <infrastructure-id> <file1> <file2> ... <fileN> <local-destination-path>`\n"
            )
            return "Fail"

        words = line.split()
        inf_id = words[0]
        vm_id = "0"  # words[1]
        destination = words[-1]
        files = words[1:-1]

        return self.apricot_transfer(
            inf_id, vm_id, files, destination, transfer_type="download"
        )

    @line_magic
    def apricot_destroy(self, inf_id):
        try:
            self.initialize_im_client()

            print(
                "Destroying... Please wait, this may take a few seconds.",
                end="",
                flush=True,
            )

            success, inf_info = self.client.destroy(inf_id)

            if success == True:
                sys.stdout.write(
                    "\r" + " " * 80 + "\r"
                )  # Overwrite the line with spaces
                sys.stdout.flush()
                print("Infrastructure with ID " + inf_id + " successfully destroyed.")
                self.remove_infrastructure_from_list(inf_id)

        except Exception as e:
            print(f"Error: {e}")
            return "Failed"

        print(inf_info)

    @line_cell_magic
    def apricot(self, code, cell=None):
        # Check if it's a cell call
        if cell is not None:
            lines = cell.split("\n")
            for line in lines:
                if len(line) > 0:
                    result = self.apricot(line.strip())
                    if result != "Done":
                        print("Execution stopped")
                        return f"Fail on line: '{line.strip()}'"
            return "Done"

        # Check if the code is empty
        if len(code) == 0:
            return "Fail"

        words = [word for word in code.split() if word]
        word1 = words[0]

        if word1 in {"exec"}:
            if len(words) < 3:
                print(
                    f"Incomplete instruction: '{code}' \n 'exec' format is: 'exec infrastructure-id cmd-command'"
                )
                return "Fail"
            else:
                inf_id = words[1]
                # vm_id = words[2]
                cmd_command = words[2:]

                try:
                    self.authfile_path
                except ValueError as e:
                    print(e)
                    return "Failed"

                ssh_user = self.resolve_ssh_user(inf_id)
                if not ssh_user:
                    print(
                        f"Error: Unable to resolve SSH user for infrastructure {inf_id}."
                    )
                    return "Failed"

                private_key_content = self.generate_key(inf_id, "0")  # vm_id
                if not private_key_content:
                    print(
                        "Error: Unable to generate private key. Missing infrastructure ID or VM ID."
                    )
                    return "Failed"

                host_ip = self.get_vm_ip(inf_id)
                if not host_ip:
                    print(
                        f"Error: Unable to resolve IP user for infrastructure {inf_id}."
                    )
                    return "Failed"

                cmd_ssh = [
                    "ssh",
                    "-i",
                    "key.pem",
                    "-o",
                    "StrictHostKeyChecking=no",
                    f"{ssh_user}@{host_ip}",
                ] + cmd_command
                output = self.execute_command(cmd_ssh)

                if output:
                    print(output)

                self.cleanup_files("key.pem")

                return "Done"

        elif word1 == "list":
            return self.apricot_ls("")

        elif word1 == "destroy":
            if len(words) != 2:
                print("Usage: destroy <infrastructure-id>")
                return "Fail"
            else:
                inf_id = words[1]

                try:
                    self.authfile_path
                except ValueError as e:
                    print("Status: fail. " + str(e) + "\n")
                    return "Failed"

                self.apricot_destroy(inf_id)

        return "Done"


def load_ipython_extension(ipython):
    """
    Any module file that define a function named `load_ipython_extension`
    can be loaded via `%load_ext module.path` or be configured to be
    autoloaded by IPython at startup time.
    """
    ipython.register_magics(Apricot_Magics)