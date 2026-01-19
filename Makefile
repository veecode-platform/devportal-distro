.PHONY: release

release:
	@# Check if on main branch
	@BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$BRANCH" != "main" ]; then \
		echo "Error: Must be on 'main' branch (currently on '$$BRANCH')"; \
		exit 1; \
	fi
	@# Pull latest changes
	@echo "Pulling latest changes..."
	@git pull || { echo "Error: git pull failed"; exit 1; }
	@# Get latest semver tag and increment
	@LATEST_TAG=$$(git tag -l '[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1); \
	if [ -z "$$LATEST_TAG" ]; then \
		echo "Error: No semver tag found"; \
		exit 1; \
	fi; \
	MAJOR=$$(echo $$LATEST_TAG | cut -d. -f1); \
	MINOR=$$(echo $$LATEST_TAG | cut -d. -f2); \
	PATCH=$$(echo $$LATEST_TAG | cut -d. -f3); \
	PATCH=$$((PATCH + 1)); \
	NEW_TAG="$$MAJOR.$$MINOR.$$PATCH"; \
	echo "Latest tag: $$LATEST_TAG"; \
	echo "Creating new tag: $$NEW_TAG"; \
	git tag -a "$$NEW_TAG" -m "$$NEW_TAG" && git push origin "$$NEW_TAG"; \
	echo "Released $$NEW_TAG"
