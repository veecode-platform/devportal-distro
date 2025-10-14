ARG TAG=1.1.4
FROM veecode/devportal-base:${TAG}

USER root

# Copy the dynamic plugins configuration
COPY dynamic-plugins.yaml /opt/app-root/src/dynamic-plugins.yaml

# Copy the installation script
COPY install-dynamic-plugins.sh /opt/app-root/src/install-dynamic-plugins.sh
RUN chmod +x /opt/app-root/src/install-dynamic-plugins.sh

# Install dynamic plugins
RUN /opt/app-root/src/install-dynamic-plugins.sh

USER 1001
