#!/usr/bin/env bash

# reads script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_ROOT="${2:-${SCRIPT_DIR}/../../dynamic-plugins-root}"
DIST_DIR="${SCRIPT_DIR}/dist"
PLUGINS_JSON="${SCRIPT_DIR}/plugins.json"

mkdir -p "${DIST_DIR}/files"
mkdir -p "${DIST_DIR}/unpacked"

echo "Processing packages from '${PLUGINS_JSON}'..."

declare -A packages_map  # associative array

while IFS= read -r line; do
  PACKAGE_NAME="${line% *}"
  PACKAGE_VERSION="${line##* }"
  packages_map["${PACKAGE_NAME}"]="${PACKAGE_VERSION}"
done < <(jq -r '.plugins[] | "\(.name) \(.version)"' "${PLUGINS_JSON}")

function generate_filename() {
  local package_name="$1"
  local package_version="$2"
  local filename="${package_name}-${package_version}.tgz"
  # replace "/" by "-" on filename
  filename="${filename//\//-}"
  # remove leading "@" on filename
  filename="${filename/\@/}"
  echo "${filename}"
}

function download_packages() {
  for PACKAGE_NAME in "${!packages_map[@]}"; do
    PACKAGE_VERSION="${packages_map["${PACKAGE_NAME}"]}"
    # download package into a new temp dir
    TEMP_DIR="${DIST_DIR}/files"
    FILENAME=$(generate_filename "${PACKAGE_NAME}" "${PACKAGE_VERSION}")
    echo "Expected file: ${FILENAME}"
    # only download if file does not exist at ${TEMP_DIR}
    if [ ! -f "${TEMP_DIR}/${FILENAME}" ]; then
      echo "Downloading ${PACKAGE_NAME}@${PACKAGE_VERSION} into ${TEMP_DIR}..."
      npm pack "${PACKAGE_NAME}@${PACKAGE_VERSION}" --pack-destination "${TEMP_DIR}" --quiet
    else
      echo "File already downloaded: ${TEMP_DIR}/${FILENAME}, skipping..."
    fi
  done
}

function unzip_packages() {
  # for each file in ${DIST_DIR}/files
  for FILE in "${DIST_DIR}/files"/*; do
    echo "Unpacking ${FILE} into ${DIST_DIR}/unpacked..."
    # get filename without folder
    FILENAME="${FILE##*/}"
    echo "Filename: ${FILENAME}"
    # remove string from FILENAME after last "-"
    PACKAGE_NAME="${FILENAME%-*}"
    echo "Package name: ${PACKAGE_NAME}"
    DEST_FILE="${DIST_DIR}/unpacked/${PACKAGE_NAME}"
    # if target path exists, remove it
    if [ -d "${DEST_FILE}" ]; then
      rm -rf "${DEST_FILE}"
    fi
    # unzip the file into ${DIST_DIR}/unpacked
    tar -xzf "${FILE}" -C "${DIST_DIR}/unpacked"
    mv "${DIST_DIR}/unpacked/package" "${DEST_FILE}"
  done
}

function clean_packages() {
  echo "Cleaning unpacked packages from '${DIST_DIR}/unpacked'..."
  rm -rf "${DIST_DIR}/unpacked"
  mkdir -p "${DIST_DIR}/unpacked"
}

function copy_packages() {
  # for each folder in ${DIST_DIR}/unpacked
  for DIR in "${DIST_DIR}/unpacked"/*; do
    # get folder name
    FOLDER_NAME="${DIR##*/}"
    # remove folder from ${PLUGINS_ROOT} if exists
    if [ -d "${PLUGINS_ROOT}/${FOLDER_NAME}" ]; then
      echo "Removing existing folder ${PLUGINS_ROOT}/${FOLDER_NAME}..."
      rm -rf "${PLUGINS_ROOT}/${FOLDER_NAME}"
    fi
    echo "Copying ${FOLDER_NAME} to ${PLUGINS_ROOT}..."
    cp -r "${DIR}" "${PLUGINS_ROOT}"
  done

}

function clean_all() {
  clean_packages
  echo "Cleaning downloaded packages..."
  rm -rf "${DIST_DIR}/files"
  mkdir -p "${DIST_DIR}/files"
}

case "$1" in
  "build")
    download_packages # download packages
    ;;
  "export-dynamic")
    unzip_packages # unzip packages from .tgz
    ;;
  "export-dynamic-clean")
    clean_packages # clean packages
    ;;
  "copy-dynamic-plugins")
    copy_packages # copy dynamic plugins to dynamic plugins root
    ;;
  "clean")
    clean_all # clean packages
    ;;
  *)
    exit 1
    ;;
esac

# parses plugins.json using 'jq' to read into PACKAGE_NAME and PACKAGE_VERSION
# for PACKAGE_NAME in "${!packages_map[@]}"; do
#   PACKAGE_VERSION="${packages_map["${PACKAGE_NAME}"]}"
#   # download package into a new temp dir
#   TEMP_DIR=$(mktemp -d)
#   echo "Downloading ${PACKAGE_NAME}@${PACKAGE_VERSION} into ${TEMP_DIR}..."
#   npm pack "${PACKAGE_NAME}@${PACKAGE_VERSION}" --pack-destination "${TEMP_DIR}" --quiet
#   # get the FILENAME as the only ".tgz" file in the temp dir
#   FILENAME="$(ls "${TEMP_DIR}" | grep ".tgz")"
#   # remove from FILENAME the "-${PACKAGE_VERSION}.tgz" suffix
#   FILESHORT="${FILENAME%-${PACKAGE_VERSION}.tgz}"
#   echo "Unpacking ${FILENAME} into ${PLUGINS_ROOT}/${FILESHORT}..."
#   tar -xzf "${TEMP_DIR}/${FILENAME}" -C "${TEMP_DIR}"
#   # if target path exists, remove it
#   if [ -d "${PLUGINS_ROOT}/${FILESHORT}" ]; then
#     rm -rf "${PLUGINS_ROOT}/${FILESHORT}"
#   fi
#   mv "${TEMP_DIR}/package" "${PLUGINS_ROOT}/${FILESHORT}"
#   # clean up (removes all files from temp dir)
#   rm -rf "${TEMP_DIR}"
#   echo "${PACKAGE_NAME}@${PACKAGE_VERSION} installed into ${PLUGINS_ROOT}/${FILESHORT}"
# done

echo "Done."
