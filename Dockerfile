# WebAppGen - Multi-platform App Generator for Websites
# Multi-platform packaging container for Linux (AppImage, DEB, RPM), Windows (.exe) and Android (.apk)
FROM node:20-alpine

# Set non-interactive environment
ENV CI=1

# Install runtime and build dependencies on Alpine Linux:
# - bash, curl, wget, git, unzip, tar, file, ca-certificates
# - openjdk17 (JDK for Android SDK and Gradle builds)
# - gcompat, libstdc++, libgcc (glibc compatibility layer for precompiled Android SDK cmdline-tools & aapt2)
# - python3, make, g++, pkgconf (native build tools)
# - fuse, rpm (Linux packaging tools)
# - rust, cargo (for Tauri builds)
RUN apk update && apk add --no-cache \
    bash \
    curl \
    wget \
    git \
    unzip \
    tar \
    file \
    ca-certificates \
    openjdk17 \
    gcompat \
    libstdc++ \
    libgcc \
    python3 \
    make \
    g++ \
    pkgconf \
    fuse \
    rpm \
    vips-dev \
    rust \
    cargo

# Configure Java and Android SDK Environment
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_USER_HOME=/root/.gradle

ENV PATH=$PATH:$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Download and install Android Command Line Tools & essential SDK components for Capacitor
ARG ANDROID_CMDLINE_TOOLS_URL=https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools /tmp/cmdline-tools && \
    wget -q ${ANDROID_CMDLINE_TOOLS_URL} -O /tmp/cmdline-tools.zip && \
    unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools && \
    mv /tmp/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && \
    rm -rf /tmp/cmdline-tools.zip /tmp/cmdline-tools && \
    yes | sdkmanager --licenses >/dev/null 2>&1 || true && \
    sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# Install global CLI tools for Capacitor and Tauri
RUN npm install -g @capacitor/cli @tauri-apps/cli

# Set up working directory
WORKDIR /app

# Configure cache directories
ENV ELECTRON_CACHE=/app/.electron-cache \
    ELECTRON_BUILDER_CACHE=/app/.electron-builder-cache \
    PORT=3000

# Clone repository from GitHub (optional override) or copy local files
ARG REPO_URL=https://github.com/asabino2/webappgen.git
ARG BRANCH=main
RUN git clone --depth 1 --branch ${BRANCH} ${REPO_URL} . || true
COPY . /app

# Install npm dependencies
RUN npm install

# Create persistent storage directories
RUN mkdir -p /app/builds /app/.electron-cache /app/.electron-builder-cache /root/.gradle

# Expose web server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/info || exit 1

# Start the application
CMD ["node", "server.js"]
