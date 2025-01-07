FROM ubuntu:22.04

USER root

RUN apt-get update && apt-get install -y \
    sshpass \
    curl \
    python3 \
    python3-pip \
    git \
    jq \
    && python3 -m pip install --upgrade pip \
    && python3 -m pip install --no-cache-dir \
        jupyterlab \
        IM-client \
        tabulate \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /home/apricotlab/

# Install the Jupyter Notebook extension
RUN git clone https://github.com/grycap/apricotlab /home/apricotlab
WORKDIR /home/apricotlab
RUN pip install -ve .

# Expose port 8888 (default port for Jupyter Lab)
EXPOSE 8888/tcp

# Command to keep container running and wait for interaction
CMD ["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root"]
