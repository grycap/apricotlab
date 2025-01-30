# APRICOTLab

[![Github Actions Status](https://github.com/grycap/apricotlab/workflows/Build/badge.svg)](https://github.com/grycap/apricotlab/actions/workflows/build.yml)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/grycap/apricotlab/main?urlpath=lab)
Advanced Platform for Reproducible Infrastructure in the Cloud via Open Tools for JupyterLab.

## Introduction

APRICOT is an open-source extension to support customised virtual infrastructure deployment and usage from Jupyter notebooks. It allows multi-cloud infrastructure provisioning using a wizard-like GUI that guides the user step by step through the deployment process. It implements IPython magic functionality to use and manage the deployed infrastructures within Jupyter notebooks for increased usability.

## Experiment replication methodology

APRICOT can be used to achieve reproducible experiments for experiments that require complex customised computing infrastructures using Jupyter notebooks. The key points to develop reproducible experiments using APRICOT extensions are:

- APRICOT provides a set of predefined configurable infrastructures to fit the experiments. Any researcher can easily deploy the same computing infrastructure than the one used in a previous experimentation carried out with the deployed infrastructure in APRICOT.

- APRICOT allows remote execution of commands at the deployed infrastructures to ease interaction. So, extra needed software can be documented and installed at the infrastructure within the same Jupyter notebook where the experimentation has been documented in order to be executed step by step.

- Since APRICOT extension uses Jupyter notebooks as base environment, all the experiment can be documented using text, life code and images.

## Requirements

APRICOT requires the Infrastructure Manager client to deploy the infrastructure and get the access credentials. The installation details can be found at [IM documentation](https://imdocs.readthedocs.io/en/devel/gstarted.html).

Also, APRICOT requires a [Jupyter installation](https://jupyter.org/install), since uses its environment to run. It is compatible with JupyterLab >= 4.0.0.

### Components

APRICOT has been constructed using the following components:

- [**Jupyter**](https://jupyter.org/), an open-source web application that allows you to create and share documents that contain live code, equations, visualizations and narrative text.
- [**IM**](https://www.grycap.upv.es/im/index.php), an open-source virtual infrastructure provisioning tool for multi-Clouds.

## Infrastructure management

To manage and use previous deployed infrastructures within Jupyter notebook environment, a set of Ipython magic functions have been implemented. These functions are listed below:

- Magic lines:
  - **apricot_log**:
    - Arguments: infrastructure identifier
    - Returns: The configuration logs of specified infrastructure
  - **apricot_ls**: Takes no arguments and returns a list with all the deployed infrastructures using this extension.
  - **apricot_info**:
    - Arguments: infrastructure identifier
    - Returns: The specifications of specified infrastructure
  - **apricot_vmls**:
    - Arguments: infrastructure identifier.
    - Return: A list of working nodes and their status at the specified infrastructure.
  - **apricot_upload**: Upload specified local files into the specified infrastructure destination path.
    - Arguments: infrastructure identifier, upload files paths, destination path.
  - **apricot_download**: Download files located at specified infrastructure to local storage.
    - Arguments: infrastructure identifier, download files paths, local destination path.
- Magic line and cell:
  - **apricot**: Perform multiple tasks depending on input command.
    - exec: Takes as arguments a infrastructure identifier and an OS command to be executed in the specified infrastructure. This call is synchronous.
    - list: Same as _apricot_ls_
    - destroy: Take a infrastructure identifier as argument an destroys the infrastructure.

Like any Jupyter magics, these must be lodaded at the notebook using _%reload_ext apricot_magics_ or configure jupyter to load these magics in all notebooks.

## Docker

A Dockerfile has been provided to construct a docker image with Jupyter and APRICOT configured. Use

`docker build -t apricotlab .`

to build the image. Then, use

`docker run --publish 8888:8888 apricotlab`

to create and execute a container. The container will start automatically a Jupyter server with APRICOT preconfigured. Then, use the url provided by Jupyter to access to the server.

## Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the apricot directory
# Install package in development mode
pip install -e "."
# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch
# Run JupyterLab in another terminal
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

## Development uninstall

```bash
pip uninstall apricot
```

In development mode, you will also need to remove the symlink created by `jupyter labextension develop`
command. To find its location, you can run `jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `apricot` within that folder.

## Packaging the extension

See [RELEASE](RELEASE.md)
