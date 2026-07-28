export PATH := $(CURDIR)/node_modules/.bin:$(PATH)
SHELL := /bin/bash

.PHONY: install build start test lint format deploy deploy-ci clean

install:
	npm install

build:
	sam build

start: build
	sam local start-api --warm-containers EAGER

start-generate: build
	sam local generate-event sqs receive-message | sam local invoke GeneratorFunction

test:
	npm test

lint:
	npm run lint

format:
	npm run format

deploy:
	sam deploy --guided

deploy-ci:
	sam deploy --no-confirm-changeset --no-fail-on-empty-changeset

clean:
	rm -rf .aws-sam dist coverage node_modules
