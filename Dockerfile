FROM ubuntu:22.04

USER root

RUN apt-get update && \
    apt-get install -y \
        sshpass \
        curl \
        python3 \
        python3-pip \
        git \
        jq \
    && \
    python3 -m pip install --upgrade pip && \
    python3 -m pip install \
        jupyterlab \
        IM-client \
        tabulate

# Install yarn
RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - && \
    echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list && \
    apt-get update && \
    apt-get install -y yarn

RUN yarn add js-yaml

RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/apricotlab && \
    git clone https://github.com/grycap/apricotlab /home/apricotlab

# Set the working directory (optional, depending on your needs)
WORKDIR /home/apricotlab/

# Install the Jupyter Notebook extension
RUN pip install -ve .

# Expose port 8888 (default port for Jupyter Lab)
EXPOSE 8888/tcp

# Command to keep container running and wait for interaction
CMD ["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root"]
