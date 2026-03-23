// @ts-check

/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('marketplace_installations', table => {
    table.string('package_name', 500).primary().notNullable();
    table.boolean('disabled').notNullable().defaultTo(false);
    table.text('config_yaml').nullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTable('marketplace_installations');
};
