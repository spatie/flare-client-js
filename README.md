# The JavaScript client for Flare to catch frontend errors

Read the JavaScript error tracking section in [the Flare documentation](https://flareapp.io/docs/javascript-error-tracking/installation) for more information.

## Maintenance

There are a few commands that can be run from the root of this repository to execute on all packages at once.

| Command      | Description                                           |
|--------------|-------------------------------------------------------|
| `build`      | Build all packages to their respective `dist` folders |
| `test`       | Run tests for all packages that have them             |
| `typescript` | Check types for all packages that have them           |
| `format`     | Run Prettier across all packages                      |

## Publishing

To publish a new package version:

- Update the version number in the package's `package.json` `version` field
- Run `npm publish`

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.

