<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/logos/outline-logo-dark.png" height="29">
    <source media="(prefers-color-scheme: light)" srcset="./public/logos/outline-logo-light.png" height="29">
    <img src="./public/logos/outline-logo-light.png" height="29" alt="Darin" />
  </picture>
</p>
<p align="center">
  <i>A fast, collaborative knowledge base for your team built using React and Node.js.</i>
</p>

This is the source code that runs **Darin**, a collaborative knowledge base based on [Outline](https://www.getoutline.com).

# Installation

Please see the [documentation](https://docs.getoutline.com/s/hosting/) for running your own copy in a production configuration.

# Development

There is a short guide for [setting up a development environment](https://docs.getoutline.com/s/hosting/doc/local-development-5hEhFRXow7).

## Architecture

If you're interested in contributing or learning more about the codebase
please refer to the [architecture document](docs/ARCHITECTURE.md) first for a high level overview of how the application is put together.

## Debugging

In development Darin outputs simple logging to the console, prefixed by categories. In production it outputs JSON logs, these can be easily parsed by your preferred log ingestion pipeline.

HTTP logging is disabled by default, but can be enabled by setting the `DEBUG=http` environment variable. Logging
can be enabled for all categories by setting `DEBUG=*` or for specific categories such as `DEBUG=database` and `LOG_LEVEL=debug`, or `LOG_LEVEL=silly` for very verbose logging.

## Tests

We aim to have sufficient test coverage for critical parts of the application and aren't aiming for 100% unit test coverage. All API endpoints and anything authentication related should be thoroughly tested.

To add new tests, write your tests with [Vitest](https://vitest.dev/) and add a file with `.test.ts` extension next to the tested code.

```shell
# To run all tests
make test

# To run backend tests in watch mode
make watch
```

Once the test database is created with `make test` you may individually run
frontend and backend tests directly with vitest:

```shell
# To run backend tests
yarn test:server

# To run a specific backend test in watch mode
yarn test path/to/file.test.ts --watch

# To run frontend tests
yarn test:app
```

## Migrations

Sequelize is used to create and run migrations, for example:

```shell
yarn db:create-migration --name my-migration
yarn db:migrate
yarn db:rollback
```

Or, to run migrations on test database:

```shell
yarn db:migrate --env test
```

# License

Based on Outline, which is [BSL 1.1 licensed](LICENSE).
