import { Entity } from '@backstage/catalog-model';

const specFields = ['appConfigExamples', 'description', 'installation'];

export const removeVerboseSpecContent = (entities: Entity[]): Entity[] => {
  return entities.map(entity => {
    if (!entity.spec) return entity;
    const spec = { ...entity.spec };
    specFields.forEach(field => delete spec[field]);
    return { ...entity, spec };
  });
};
