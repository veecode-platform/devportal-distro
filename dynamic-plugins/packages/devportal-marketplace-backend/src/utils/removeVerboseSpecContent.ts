import { Entity } from '@backstage/catalog-model';

const specFields = ['appConfigExamples', 'description', 'installation'];

export const removeVerboseSpecContent = (entities: Entity[]) => {
  entities.forEach(entity => {
    specFields.forEach(specField => delete entity.spec?.[specField]);
  });
};
