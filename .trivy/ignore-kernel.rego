# Rego policy to ignore kernel package vulnerabilities
# See: https://trivy.dev/docs/latest/configuration/filtering/#by-rego-policy
#
# Kernel vulnerabilities are ignored because:
# - Containers share the host kernel, not the kernel package in the image
# - These CVEs require host-level remediation, not container image updates
# - Most kernel CVEs require local access (AV:L) and are lower risk for containerized workloads

package trivy

default ignore = false

# Ignore all vulnerabilities in kernel and kernel-headers packages
ignore {
	input.PkgName == "kernel"
}

ignore {
	input.PkgName == "kernel-headers"
}

ignore {
	input.PkgName == "kernel-core"
}

ignore {
	input.PkgName == "kernel-modules"
}

ignore {
	input.PkgName == "kernel-modules-core"
}

ignore {
	input.PkgName == "kernel-modules-extra"
}

# Catch any kernel-related package using startswith
ignore {
	startswith(input.PkgName, "kernel-")
}
